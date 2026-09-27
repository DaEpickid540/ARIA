// lib/load-env.js — imported first by server.js, so every module after it
// sees the keys from .env (see lib/keys.js). A side-effect import because
// ES module imports all run before server.js's own code does.
import { loadEnvFile } from "./keys.js";

loadEnvFile();
