// socketService.js
// Initializes Socket.IO on the shared HTTP server and broadcasts
// real-time authentication + activity + risk + security events to clients.

const { Server } = require("socket.io");

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket) => {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    const role = socket.handshake.auth?.role || socket.handshake.query?.role;
    if (userId) socket.join(`user:${userId}`);
    if (role === 'admin') socket.join('admins');
    if (role === 'doctor') socket.join('doctors');
    io.emit("system:connection", {
      status: "connected",
      socketId: socket.id,
      time: new Date().toISOString(),
    });

    socket.emit("system:status", { status: "connected" });

    socket.on("disconnect", () => {
      io.emit("system:connection", {
        status: "disconnected",
        socketId: socket.id,
        time: new Date().toISOString(),
      });
    });
  });

  return io;
}

function emitDoctorLogin(io, payload) {
  io.emit("auth:user-login", payload);
}

function emitActivityNew(io, payload) {
  io.emit("activity:new", payload);
}

function emitRiskUpdated(io, payload) {
  io.emit("risk:updated", payload);
}

function emitHighRiskAlert(io, payload) {
  io.emit("security:high-risk-alert", payload);
}

function emitCriticalAlert(io, payload) {
  io.emit("security:critical-alert", payload);
}

module.exports = {
  initSocket,
  emitDoctorLogin,
  emitActivityNew,
  emitRiskUpdated,
  emitHighRiskAlert,
  emitCriticalAlert,
};
