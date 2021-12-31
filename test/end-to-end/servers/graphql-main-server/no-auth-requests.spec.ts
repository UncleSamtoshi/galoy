import { yamlConfig, JWT_SECRET } from "@config/app"
import * as jwt from "jsonwebtoken"

import USER_REQUEST_AUTH_CODE from "./mutations/user-request-auth-code.gql"
import USER_LOGIN from "./mutations/user-login.gql"
import { clearAccountLocks, clearLimiters } from "test/helpers"
// import { startServer, killServer } from "test/helpers/integration-server"
import { createApolloClient } from "test/helpers/apollo-client"

jest.mock("@services/twilio", () => require("test/mocks/twilio"))

let correctCode, apolloClient, disposeClient
const { phone, code } = yamlConfig.test_accounts[9]

beforeAll(async () => {
  correctCode = `${code}`
  // await startServer()
    ; ({ apolloClient, disposeClient } = createApolloClient())
})

beforeEach(async () => {
  await clearLimiters()
  await clearAccountLocks()
})

afterAll(async () => {
  disposeClient()
  // await killServer()
})

describe("graphql", () => {
  describe("userRequestAuthCode", () => {
    const mutation = USER_REQUEST_AUTH_CODE

    it("success with a valid phone", async () => {
      const input = { phone }
      const result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userRequestAuthCode).toEqual(
        expect.objectContaining({ success: true }),
      )
    })

    it("returns error for invalid phone", async () => {
      const message = "Invalid value for Phone"
      let input = { phone: "+123" }

      let result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userRequestAuthCode.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      input = { phone: "abcd" }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userRequestAuthCode.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      input = { phone: "" }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userRequestAuthCode.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )
    })
  })

  describe("userLogin", () => {
    const mutation = USER_LOGIN

    it("returns a jwt token for a valid phone/code", async () => {
      const input = { phone, code: correctCode }
      const result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin).toHaveProperty("authToken")
      const token = jwt.verify(result.data.userLogin.authToken, `${JWT_SECRET}`)
      expect(token).toHaveProperty("uid")
      expect(token).toHaveProperty("network")
      expect(token).toHaveProperty("iat")
    })

    it("returns error for invalid phone", async () => {
      let phone = "+19999999999"
      let message = "Invalid or incorrect phone code entered."
      let input = { phone, code: correctCode }
      let result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      phone = "+1999"
      message = "Invalid value for Phone"
      input = { phone, code: correctCode }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      phone = "abcd"
      input = { phone, code: correctCode }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      phone = ""
      input = { phone, code: correctCode }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )
    })

    it("returns error for invalid code", async () => {
      let message = "Invalid or incorrect phone code entered."
      let input = { phone, code: "113566" }
      let result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      message = "Invalid value for OneTimeAuthCode"
      input = { phone, code: "abcdef" }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )

      input = { phone, code: "" }
      result = await apolloClient.mutate({mutation, variables: { input } })
      expect(result.data.userLogin.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ message })]),
      )
    })
  })
})
