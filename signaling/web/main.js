"use strict";

const wsUrl =
	location.hostname === "localhost"
		? `ws://${location.host}/rooms/hello/ws`
		: `wss://${location.host}/rooms/hello/ws`;

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

			const addr = document.getElementById("turnServerAddress").value;

			const iceServers = [
				{
					url: `stun:${addr}:3478`,
				},
				{
					url: `turn:${addr}:3478`,
					username: "foo",
					credential: "bar",
				},
			];

			conn = new RTCPeerConnection({
				iceServers,
			});
			conn.addEventListener("connectionstatechange", console.log);
			const candidates = [];
			conn.addEventListener("icecandidate", (event) => {
				if (event.candidate == null) {
					return;
				}
				// if (event.candidate.type !== "relay") {
				// 	return;
				// }
				const payload = JSON.stringify({
					type: "icecandidate",
					candidate: event.candidate,
				});
				console.log("send icecandidate", event.candidate, payload);

				ws.send("*\n" + payload);
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
				const obj = JSON.parse(payload);
				console.log("onmessage", roomId, from, to, payload, obj);

				if (obj.type === "offer") {
					await conn.setRemoteDescription(obj);
					const answer = await conn.createAnswer();
					await conn.setLocalDescription(answer);
					console.log("recieved offer, send answer", answer);
					ws.send(from + "\n" + JSON.stringify(answer));
				} else if (obj.type === "answer") {
					await conn.setRemoteDescription(obj);
					console.log("recieved answer");
				} else if (obj.type === "icecandidate") {
					console.log("recieved icecandidate", obj.candidate);
					await conn.addIceCandidate(obj.candidate);
				}
			});
		} catch (err) {
			console.log(err);
		}
	});
