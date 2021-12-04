import { GT } from "@graphql/index"
import Coordinates from "@graphql/types/object/coordinates"
import Timestamp from "@graphql/types/scalar/timestamp"
import Username from "@graphql/types/scalar/username"
import { UsersRepository } from "@services/mongoose"
import AccountLevel from "../scalar/account-level"
import AccountStatus from "../scalar/account-status"
import User from "./user"

const Account = new GT.Object({
  name: "AccountDetail",
  fields: () => ({
    id: { type: GT.NonNullID },
    username: { type: Username },
    level: { type: AccountLevel },
    status: { type: AccountStatus },
    title: { type: GT.String },
    owner: {
      // should be used for individual account only,
      // ie: when there are no multiple users
      // probably separating AccountDetail to DetailConsumerAccount
      // with DetailCorporateAccount is a way to have owner only in DetailConsumerAccount
      // and users: [Users] in DetailCorporateAccount

      type: GT.NonNull(User),
      resolve: async (source) => {
        const user = await UsersRepository().findById(source.id) // FIXME/TODO should it be source.ownerId?
        if (user instanceof Error) {
          throw user
        }

        return user
      },
    },
    coordinates: {
      type: Coordinates,
      resolve: (source) => source.coordinates,
    },
    createdAt: {
      type: GT.NonNull(Timestamp),
      resolve: (source) => source.createdAt ?? source.created_at, // TODO: Get rid of this resolver
    },
  }),
})

export default Account