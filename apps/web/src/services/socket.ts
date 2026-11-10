import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** One shared connection. The session cookie authenticates it and the server joins the rooms. */
export function getSocket(): Socket {
  if (!socket) {
    const url: string | undefined = import.meta.env.VITE_API_URL || undefined;
    socket = io(url, { withCredentials: true });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
