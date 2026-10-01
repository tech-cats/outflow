import { cfPlatform, type CfEnv } from '../adapters/cf'
import { createApp } from '../app'

export { CollabRoom } from '../collab/durable-object'

const app = createApp({
  getPlatform: (c) => cfPlatform(c.env as CfEnv, c.executionCtx),
  staticFallback: (c) => (c.env as CfEnv).ASSETS.fetch(c.req.raw),
})

export default app
