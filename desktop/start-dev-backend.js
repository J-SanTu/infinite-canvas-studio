process.env.BACKEND_PORT = process.env.BACKEND_PORT || "5202";
const { startServer } = await import("../server.js");
await startServer({ port: Number(process.env.BACKEND_PORT), host: "127.0.0.1" });
