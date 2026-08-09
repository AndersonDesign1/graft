import { FunctionDescriptor } from "@usegraft/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import { field } from "./field";
import { defineFunction, type FunctionInput, type FunctionOutput } from "./function";

const subscribe = defineFunction({
  name: "subscribe",
  kind: "mutation",
  description: "Adds an email to the newsletter list.",
  returns: "{ subscribed: boolean }",
  input: {
    email: field.string({ description: "Address to subscribe." }),
    source: field.string({ optional: true }),
  },
  handler: ({ input }) => ({ subscribed: true, email: input.email }),
});

describe("defineFunction", () => {
  it("builds a Zod schema from input fields", () => {
    expect(subscribe.schema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(subscribe.schema.safeParse({}).success).toBe(false);
  });

  it("infers exact input and output types (no codegen)", () => {
    expectTypeOf<FunctionInput<typeof subscribe>>().toEqualTypeOf<{
      email: string;
      source?: string;
    }>();
    expectTypeOf<FunctionOutput<typeof subscribe>>().toEqualTypeOf<{
      subscribed: boolean;
      email: string;
    }>();
  });

  it("describe() yields a valid contracts FunctionDescriptor", () => {
    const descriptor = FunctionDescriptor.parse(subscribe.describe());
    expect(descriptor).toMatchObject({
      name: "subscribe",
      kind: "mutation",
      returns: "{ subscribed: boolean }",
    });
    expect(descriptor.args).toEqual([
      {
        name: "email",
        type: "string",
        optional: false,
        description: "Address to subscribe.",
      },
      { name: "source", type: "string", optional: true, description: undefined },
    ]);
  });

  it("supports empty input (zero-arg queries)", () => {
    const ping = defineFunction({
      name: "ping",
      kind: "query",
      input: {},
      handler: () => "pong",
    });
    expect(ping.schema.safeParse({}).success).toBe(true);
    expect(ping.describe().args).toEqual([]);
  });
});
