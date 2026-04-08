import { type Static, Type } from "@sinclair/typebox";

export const placeholderToolSchema = Type.Object({
  itemId: Type.String({
    minLength: 1,
  }),
});

export type PlaceholderToolInput = Static<typeof placeholderToolSchema>;
