package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/rs/zerolog/pkgerrors"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type wsclient struct {
	roomID string
	id     string
	conn   *websocket.Conn
}

func (c wsclient) sender(snd <-chan wsMessage, unregister chan<- wsclient) {
	defer func() {
		c.conn.Close()
		unregister<- c
	}()

	for msg := range snd {
		log.Debug().Str("roomID", c.roomID).Str("id", c.id).Str("payload", string(msg.payload)).Msg("conn.WriteMessage")
		if err := c.conn.WriteMessage(msg.messageType, msg.payload); err != nil {
			log.Debug().Err(err).Msg("c.conn.WriteMessage")
			return
		}
	}
}

func (c wsclient) receiver(ctx context.Context, msg chan<- message, unregister chan<- wsclient) {
	defer func() {
		c.conn.Close()
		unregister<- c
	}()

	for {
		log.Debug().Str("roomID", c.roomID).Str("id", c.id).Msg("waiting message...")
		mt, p, err := c.conn.ReadMessage()
		if err != nil {
			log.Debug().Err(err).Msg("c.conn.ReadMessage")
			return
		}

		msg <- message{roomID: c.roomID, clientID: c.id, wsMessage: wsMessage{messageType: mt, payload: p}}
	}
}

type wsMessage struct {
	messageType int
	payload     []byte
}

type message struct {
	roomID   string
	clientID string
	wsMessage
	err error
}

type registrar chan<- wsclient

var i = 0

func (r registrar) registerWebsocket(c echo.Context) error {
	i++

	log.Debug().Int("id", i).Msg("begin registerWebsocket")
	defer log.Debug().Int("id", i).Msg("end registerWebsocket")

	w := c.Response()
	req := c.Request()
	roomID := c.Param("id")

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		return err
	}

	r <- wsclient{roomID: roomID, id: fmt.Sprintf("hello%d", i), conn: conn}

	return nil
}

func runPubSub(ctx context.Context) registrar {
	register := make(chan wsclient)

	go func() {
		// rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "", DB: 0})
		rdb := redis.NewClient(&redis.Options{Addr: "redis:6379", Password: "", DB: 0})
		sub := rdb.Subscribe(ctx, "sdp")
		rooms := make(map[string]map[string]chan<- wsMessage)
		unregister := make(chan wsclient)
		msg := make(chan message)

		for {
			select {
			case m := <-msg:
				log.Debug().Str("roomID", m.roomID).Str("clientID", m.clientID).Str("payload", string(m.payload)).Msg("recieve message")
				payload := append([]byte(m.roomID + "\n" + m.clientID + "\n"), m.payload ...)
				if err := rdb.Publish(ctx, "sdp", payload).Err(); err != nil {
					log.Debug().Err(err).Msg("rdb.Publish")
					return
				}

			case client := <-unregister:
				if _, ok := rooms[client.roomID]; !ok {
					continue
				}

				if _, ok := rooms[client.roomID][client.id]; !ok {
					continue
				}

				close(rooms[client.roomID][client.id])
				delete(rooms[client.roomID], client.id)

				if len(rooms[client.roomID]) == 0 {
					delete(rooms, client.roomID)
				}

			case client := <-register:
				if _, ok := rooms[client.roomID]; !ok {
					rooms[client.roomID] = make(map[string]chan<- wsMessage)
				}

				snd := make(chan wsMessage)
				rooms[client.roomID][client.id] = snd
				log.Debug().Str("roomID", client.roomID).Str("clientID", client.id).Msg("register")

				go client.sender(snd, unregister)
				go client.receiver(ctx, msg, unregister)


			case rmsg := <-sub.Channel():
				ss := strings.Split(rmsg.Payload, "\n")
				if len(ss) != 4 {
					log.Error().Str("payload", rmsg.Payload).Msg("parseHeader")
					return
				}
				roomID, from, to := ss[0], ss[1], ss[2]
				log.Debug().Str("roomID", roomID).Str("from", from).Str("to", to).Str("payload", rmsg.Payload).Msg("msg from redis")

				if to == "*" {
					for id, snd := range rooms[roomID] {
						if id != from {
							snd <- wsMessage{messageType: websocket.TextMessage, payload: []byte(rmsg.Payload)}
						}
					}
					continue
				}

				if snd, ok := rooms[roomID][to]; ok {
					snd <- wsMessage{messageType: websocket.TextMessage, payload: []byte(rmsg.Payload)}
				}

			}
		}
	} ()

	return registrar(register)
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
	zerolog.ErrorStackMarshaler = pkgerrors.MarshalStack
	zerolog.SetGlobalLevel(zerolog.DebugLevel)

	e := echo.New()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r := runPubSub(ctx)

	e.HTTPErrorHandler = func(err error, c echo.Context) {
		log.Debug().Err(err).Msg(fmt.Sprintf("%+v", err))
		e.DefaultHTTPErrorHandler(err, c)
	}

	e.GET("/rooms/:id/ws", r.registerWebsocket)
	e.GET("/hello", func(c echo.Context) error {
		return c.HTML(http.StatusOK, "<h1>Hello, world!</h1>")
	})

	e.Static("/", "./web")

	e.Logger.Fatal(e.Start(":80"))
}
