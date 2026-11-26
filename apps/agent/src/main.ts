#!/usr/bin/env node
import { text } from "node:stream/consumers";
import { turnInputSchema, type TurnStreamEvent } from "@tetherbox/core";
import { runTurn } from "./session.ts";

const writeStdout = process.stdout.write.bind(process.stdout);

// stdout carries only newline-delimited TurnStreamEvent JSON for the daemon, so everything else
// goes to stderr.
process.stdout.write = process.stderr.write.bind(process.stderr);

function emit(event: TurnStreamEvent): void {
  writeStdout(`${JSON.stringify(event)}\n`);
}

const input = turnInputSchema.parse(JSON.parse(await text(process.stdin)));

await runTurn(input, emit);
