FROM golang:1.16.3 AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY ./main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main

FROM alpine AS runner

COPY --from=builder /build/main /main
