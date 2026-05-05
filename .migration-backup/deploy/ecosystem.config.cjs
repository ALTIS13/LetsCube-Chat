// pm2 process manifest — keeps both services running and restarts on crash.
// Used by deploy.sh:   pm2 startOrReload deploy/ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: "neogram-web",
      cwd: "/var/www/neogram",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      // Next.js reads .env.production automatically; no need to inline secrets here.
      out_file: "/var/log/neogram/web.out.log",
      error_file: "/var/log/neogram/web.err.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "neogram-bot",
      cwd: "/var/www/neogram/bot",
      script: "bot.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      // bot.js loads its own bot/.env via dotenv.
      out_file: "/var/log/neogram/bot.out.log",
      error_file: "/var/log/neogram/bot.err.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "neogram-push",
      cwd: "/var/www/neogram/push-worker",
      script: "index.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
      },
      // push-worker/.env holds Supabase service role + VAPID keys.
      out_file: "/var/log/neogram/push.out.log",
      error_file: "/var/log/neogram/push.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
