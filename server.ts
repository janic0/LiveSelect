import ws from "ws";
import express from "express";
import path from "path";
import { v4 as uuid } from "uuid";

const wsServer = new ws.Server({ noServer: true });

interface client {
	id: string | null;
	open: boolean;
	socket: ws;
	selected_id: string | null;
	space_id: string | null;
}

interface space {
	id: string;
	space_name: string;
	options: {
		id: string;
		text: string;
	}[];
}

const clients: { [key: string]: client } = {};
const spaces: { [key: string]: space } = {};

wsServer.on("connection", (sock) => {
	let id: string | null = null;
	sock.on("open", () => {
		sock.send(JSON.stringify({ type: "ping" }));
	});
	sock.on("message", (body) => {
		let rawData = {} as any;
		try {
			rawData = JSON.parse(body.toString());
		} catch (e) {
			console.trace(e);
		}
		const { data, token, type } = rawData;

		const getClient = (): client => {
			if (token && clients[token]) {
				id = token;
				const value = clients[token];
				value.open = true;
				value.socket = sock;
				clients[token] = value;
				return value;
			} else if (id && clients[id]) {
				const value = clients[id];
				value.open = true;
				value.socket = sock;
				clients[id] = value;
				return value;
			} else {
				id = uuid();
				sock.send(JSON.stringify({ type: "session", data: id }));
				const client = {
					id,
					open: true,
					socket: sock,
					selected_id: null,
					space_id: null,
				};
				clients[id] = client;
				return client;
			}
		};

		let client = getClient();

		const refreshClients = (client: client, all = false) => {
			console.log(client.id, client.open, client.selected_id, client.space_id);
			if (!client.space_id) return;
			const result: {
				member_count: number;
				space_title: string;
				options: {
					id: string;
					text: string;
					votes: number;
				}[];
				selected_id: string | null;
			} = {
				member_count: 0,
				space_title: "",
				options: [],
				selected_id: null,
			};
			const votes: { [key: string]: number } = {};
			for (const key in clients) {
				const remoteClient = clients[key];
				if (client.space_id == remoteClient.space_id) {
					if (remoteClient.open) result.member_count++;
					if (remoteClient.selected_id) {
						votes[remoteClient.selected_id] =
							(votes[remoteClient.selected_id] || 0) + 1;
					}
				}
			}
			const space = spaces[client.space_id];
			const newOptions = space.options.map((option) => {
				return {
					...option,
					votes: votes[option.id] || 0,
				};
			});
			result.options = newOptions;
			result.space_title = space.space_name;
			result.selected_id = client.selected_id;
			console.log(result);
			if (!all) sock.send(JSON.stringify({ type: "data", data: result }));
			else {
				for (const key in clients) {
					const remoteClient = clients[key];
					if (remoteClient.open && client.space_id == remoteClient.space_id) {
						result.selected_id = remoteClient.selected_id;
						console.log(remoteClient.socket.readyState);
						remoteClient.socket.send(
							JSON.stringify({ type: "data", data: result })
						);
					}
				}
			}
		};

		if (type === "create" && typeof data === "string" && id) {
			const space_id = uuid();
			spaces[space_id] = {
				id: space_id,
				space_name: data,
				options: [],
			};
			clients[id] = { ...client, space_id };
			sock.send(JSON.stringify({ type: "join", data: space_id }));
		} else if (type === "join" && typeof data === "string" && id) {
			if (spaces[data]) {
				clients[id].space_id = data;
				refreshClients(client, true);
				sock.send(JSON.stringify({ type: "join", data: data }));
			} else {
				sock.send(JSON.stringify({ type: "error", data: "space not found" }));
			}
		} else if (type === "add_option" && typeof data === "string" && id) {
			if (!data)
				return sock.send(
					JSON.stringify({ type: "error", data: "no option value" })
				);
			if (!client.space_id)
				return sock.send(
					JSON.stringify({ type: "error", data: "no space selected" })
				);
			const space = spaces[client.space_id];
			if (!space) return;
			space.options.push({ id: uuid(), text: data });
			refreshClients(client, true);
		} else if (type === "select" && typeof data === "string") {
			if (!client.space_id)
				return sock.send(
					JSON.stringify({ type: "error", data: "no space selected" })
				);
			const space = spaces[client.space_id];
			if (!space) return;
			const option = space.options.find((option) => option.id === data);
			if (!option) return;
			client.selected_id = option.id;
			refreshClients(client, true);
		} else if (type === "ping") {
			sock.send(JSON.stringify({ type: "pong" }));
		} else if (type === "load") {
			refreshClients(client);
		}
	});
	sock.on("close", () => {
		if (id && clients[id]) clients[id].open = false;
	});
});

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/*", (_, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(8080, "0.0.0.0", () => {
	console.log("listening on port 8080");
});

server.on("upgrade", (req, sock, head) => {
	wsServer.handleUpgrade(req, sock, head, (socket) =>
		wsServer.emit("connection", socket, req)
	);
});
