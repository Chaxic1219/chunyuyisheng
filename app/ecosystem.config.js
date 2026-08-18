
module.exports = {
  apps: [{
    name: "chunyu-doctor",
    cwd: "/var/www/chunyu-doctor-review/app",
    script: "server.js",
    interpreter: "node",
    env: {
      PORT: "3200",
      DB_PATH: "/var/lib/chunyu-doctor/data.db"
    }
  }]
};
