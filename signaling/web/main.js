"use strict";

const wsUrl =
	location.hostname === "localhost"
		? `ws://${location.host}/rooms/hello/ws`
		: `wss://${location.host}/rooms/hello/ws`;

const iceServers =
	location.hostname === "localhost"
		? [
				{
					url: "stun:stun.l.google.com:19302",
				},
				{
					url: "turn:localhost:3478",
					username: "foo",
					credential: "bar",
				},
		  ]
		: [
				{
					url: "stun:stun.l.google.com:19302",
				},
		  ];

let ws = null;
let conn = null;

document
	.getElementById("sendOfferButton")
	.addEventListener("click", async () => {
		const offer = await conn.createOffer();
		await conn.setLocalDescription(offer);
		console.log("offer", offer);

		console.log("send offer");
		ws.send("*\n" + JSON.stringify(offer));
	});

document
	.getElementById("sdpStartButton")
	.addEventListener("click", async (event) => {
		event.target.disabled = true;
		try {
			ws = new WebSocket(wsUrl);
			ws.addEventListener("open", async () => {
				console.log("open");
				document.getElementById("sendOfferButton").disabled = false;
			});

			ws.addEventListener("close", () => console.log("close"));
			ws.addEventListener("error", (event) => {
				console.log("wserror:", event);
			});
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: true,
			});
			const localVideo = document.getElementById("localVideo");
			localVideo.srcObject = stream;

			conn = new RTCPeerConnection({
				iceServers: iceServers,
			});
			conn.addEventListener("connectionstatechange", console.log);
			const candidates = [];
			conn.addEventListener("icecandidate", (event) => {
				if (event.candidate) {
					console.log("icecandidate", event.candidate);
					candidates.push(event.candidate);
				}
			});
			conn.addEventListener("icecandidateerror", ({ errorCode, errorText }) => {
				console.log("icecandidateerror", { errorCode, errorText });
			});
			conn.addEventListener("iceconnectionstatechange", (event) => {
				console.log("iceconnectionstatechange", {
					iceConnectionState: event.currentTarget.iceConnectionState,
					iceGatheringState: event.currentTarget.iceGatheringState,
				});
			});
			conn.addEventListener("icegatheringstatechange", (event) => {
				console.log("icegatheringstatechange", {
					iceConnectionState: event.currentTarget.iceConnectionState,
					iceGatheringState: event.currentTarget.iceGatheringState,
				});
			});
			conn.addEventListener("negotiationneeded", console.log);
			conn.addEventListener("statsended", console.log);
			conn.addEventListener("track", (event) => {
				console.log("ontrack", "remote video start");
				const stream = event.streams[0];
				document.getElementById("remoteVideo").srcObject = stream;
			});

			stream.getTracks().forEach((track) => {
				conn.addTrack(track, stream);
			});

			ws.addEventListener("message", async (event) => {
				console.log("wsmessage", event);
				if (typeof event.data !== "string") {
					console.log("invalid data type");
					return;
				}

				const [roomId, from, to, payload] = event.data.split("\n");
				console.log("onmessage", roomId, from, to);
				const obj = JSON.parse(payload);
				console.log(obj);

				if (obj.type === "offer") {
					await conn.setRemoteDescription(obj);
					const answer = await conn.createAnswer();
					await conn.setLocalDescription(answer);
					console.log("recieved offer, send answer", answer);
					ws.send(from + "\n" + JSON.stringify(answer));
				} else if (obj.type === "answer") {
					await conn.setRemoteDescription(obj);
					console.log("recieved answer and send icecandidates", candidates);
					ws.send(
						from + "\n" + JSON.stringify({ type: "icecandidate", candidates })
					);
				} else if (obj.type === "icecandidate") {
					console.log("recieved icecandidates", candidates);
					for (const candidate of obj.candidates) {
						await conn.addIceCandidate(candidate);
					}
				}
			});
		} catch (err) {
			console.log(err);
		}
	});
