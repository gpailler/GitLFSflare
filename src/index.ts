export default {
  async fetch(): Promise<Response> {
    return new Response("Git LFS Server");
  },
};
