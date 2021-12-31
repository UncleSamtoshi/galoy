const { redis, redisSub } = require("@services/redis")
const { setupMongoConnection } = require("@services/mongodb")
const { startServer, killServer } = require("../test/helpers/integration-server")
let mongoose

beforeAll(async () => {
  mongoose = await setupMongoConnection(true)
  // console.log(await startServer())
})

afterAll(async () => {
  // avoids to use --forceExit
  redis.disconnect()
  redisSub.disconnect()
  if (mongoose) {
    await mongoose.connection.close()
  }
  // await killServer()
})

jest.setTimeout(process.env.JEST_TIMEOUT || 50000)
