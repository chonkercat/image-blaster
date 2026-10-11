---
name: image-blast-image-edit
description: Generate one image edit from explicit input images and a prompt. Use for source cleanup, clean plates, object removal, or other Tripo-backed image edits.
argument-hint: [image path] [prompt] [optional output dir, role, output slug]
allowed-tools: Read Write Glob Bash(ls *) Bash(node .claude/scripts/project/ensure-local-assets.mjs *) Bash(node .claude/scripts/image-edit/generate-edit.mjs *)
context: fork
agent: image-blast-image-edit
---

Create one edited image.

## Instructions

- Require at least one input image and one edit prompt.
- Use `ls -a` before reading generated state.
- Use the output directory, role, and output slug provided by the caller.
- Use `--role` for semantics such as `plate`, `object-mask`, or `image-edit`.
- Use `--output-slug` for the visible indexed artifact name, such as `<source-slug>-plate`.

Run:

```bash
node .claude/scripts/image-edit/generate-edit.mjs \
  --image "<input image path>" \
  --prompt "<edit prompt>" \
  --output-dir "<output directory>" \
  --role "<role>" \
  --output-slug "<output slug>"
```

The provider is Tripo (`--provider tripo`). Set `TRIPO_IMAGE_MODEL` in `.env` to choose the Tripo image model; the default is `seedream_v5`. Use `TRIPO_API_KEY` for generation, never a general AI token.

If request metadata records provider URLs but local image files are missing, fill them from the matching hidden request JSON:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "<request-json-path>"
```

Final response: report input images, output image, request metadata, role, and prompt used.

