# tools/forge — Pod lab (Phase 2)

Forge (open-source MTG rules engine, Java) runs full AI-vs-AI Commander games in simulation mode:

```
java -jar <forge jar> sim -d <deck1> <deck2> <deck3> <deck4> -f commander -n <games> -q
```

- Install Forge locally into `tools/forge/forge/` (git-ignored); set `FORGE_JAR` in `.env`.
- Confirm the exact jar name and flags for the installed version (see https://github.com/Card-Forge/forge/wiki/ai).
- Run as separate JVM processes only (copyleft licence, crash isolation).
- Design: docs/SIMULATION.md Part B.
