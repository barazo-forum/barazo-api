import { parseEnv } from './config/env.js'
import { buildApp } from './app.js'

async function main() {
  const env = parseEnv(process.env)
  const app = await buildApp(env)

  try {
    await app.listen({ host: env.HOST, port: env.PORT })
  } catch (err) {
    app.log.fatal(err, 'Failed to start server')
    process.exit(1)
  }
}

void main()
