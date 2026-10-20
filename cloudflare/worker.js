import { handleApi } from "./api.js";
export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/"))
      return handleApi(request, env, context);
    return env.ASSETS.fetch(request);
  },
};
