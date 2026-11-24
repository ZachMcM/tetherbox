#!/usr/bin/env node
import { text } from "node:stream/consumers";
import { turnInputSchema } from "@tetherbox/core";
import { runTurn } from "./session.ts";

const writeResult = process.stdout.write.bind(process.stdout);

// stdout carries only the TurnResult the daemon parses, so everything else goes to stderr.
process.stdout.write = process.stderr.write.bind(process.stderr);

const input = turnInputSchema.parse(JSON.parse(await text(process.stdin)));
const result = await runTurn(input);

writeResult(JSON.stringify(result));
