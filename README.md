# Mars Pair Programmers - Habitat Automation

Distributed event-driven platform for Mars habitat automation (2-person team scope).

## Quick start

Prerequisite (from repository root): load the provided simulator image into Docker.

```bash
docker load -i mars-iot-simulator-oci.tar
```

Then start the full stack:

```bash
cd source
docker compose up -d --build
```

Open dashboard at `http://localhost:3000`.

## Main docs

- [input.md](input.md)
- [Student_doc.md](Student_doc.md)
- [booklets/diagrams/architecture.md](booklets/diagrams/architecture.md)
- [booklets/user-stories.md](booklets/user-stories.md)
- [booklets/mockups/user-stories-lofi.md](booklets/mockups/user-stories-lofi.md)
- [booklets/slides/presentation.md](booklets/slides/presentation.md)
