import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Pages serves the site under /<repo>/, dev serves at /. The runtime fetch
// uses import.meta.env.BASE_URL so it lines up with whichever base is active.
export default defineConfig(({ command }) => ({
  plugins: [svelte()],
  base: command === "build" ? "/autoware-repos-visualizer/" : "/",
}));
