export default {
  root: import.meta.dirname,
  server: { strictPort: false },
  optimizeDeps: { exclude: ["superdoc", "@superdoc/docx-engine"] },
};
