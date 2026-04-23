import { Command } from "commander";

const program = new Command();
program.name("gpt-image-cli").version("1.0.0").description("OpenAI gpt-image-2 CLI");
program.parse(process.argv);
