task 1: done — pure lease algebra + lint baseline
task 2: done — claude/grok adapters + normalizePayload
task 3: done — lease-backed stampFromHook + RC1 Grok Stop
task 4: done — lease-aware settle RC2
task 5: done — PID backstop + SessionEnd
task 6: done — bar glyph from lease state
task 7: done — providers reader + golden fixtures
task 8: done — oracle feed, sage bridge, optional lines
task 9: done — doctor + settle_ts
doctor live:
✓ hooks:claude — claude hook absolute + resolvable
✓ hooks:grok — grok hook absolute + resolvable
✓ tmux — tmux reachable
✓ session:eventizer-2:state — state=done
✓ session:eventizer-2:leases — leases parseable (0 entries)
✗ session:eventizer-2:settle_ts — no settle stamp — card loop may not be ticking
✓ session:herald-sage-oracle-armory:state — state=working
✓ session:herald-sage-oracle-armory:leases — leases parseable (0 entries)
✗ session:herald-sage-oracle-armory:settle_ts — no settle stamp — card loop may not be ticking
✓ session:hermes:state — state=compacting
✓ session:hermes:leases — leases parseable (0 entries)
✓ session:oracle:state — state=done
✓ session:oracle:leases — leases parseable (0 entries)
✗ session:oracle:settle_ts — no settle stamp — card loop may not be ticking
✓ session:sage:state — state=done
✓ session:sage:leases — leases parseable (0 entries)
✗ session:sage:settle_ts — no settle stamp — card loop may not be ticking
✓ session:status:state — state=done
✓ session:status:leases — leases parseable (0 entries)
✗ session:status:settle_ts — no settle stamp — card loop may not be ticking
✓ session:stream engine:state — state=compacting
✓ session:stream engine:leases — leases parseable (0 entries)
✓ session:syndcast:state — state=needs
✓ session:syndcast:leases — leases parseable (0 entries)
✗ session:syndcast:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast :state — state=working
✓ session:syndcast :leases — leases parseable (0 entries)
✗ session:syndcast :settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-11:state — state=done
✓ session:syndcast-11:leases — leases parseable (0 entries)
✗ session:syndcast-11:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-3:state — state=done
✓ session:syndcast-3:leases — leases parseable (0 entries)
✗ session:syndcast-3:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-4:state — state=done
✓ session:syndcast-4:leases — leases parseable (0 entries)
✗ session:syndcast-4:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-5:state — state=done
✓ session:syndcast-5:leases — leases parseable (0 entries)
✗ session:syndcast-5:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-6:state — state=done
✓ session:syndcast-6:leases — leases parseable (0 entries)
✗ session:syndcast-6:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-7:state — state=done
✓ session:syndcast-7:leases — leases parseable (0 entries)
✗ session:syndcast-7:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-8:state — state=done
✓ session:syndcast-8:leases — leases parseable (0 entries)
✗ session:syndcast-8:settle_ts — no settle stamp — card loop may not be ticking
✓ session:token-oracle:state — state=idle
✓ session:token-oracle:leases — leases parseable (0 entries)
✓ session:token-oracle-2:state — state=done
✓ session:token-oracle-2:leases — leases parseable (0 entries)
✗ session:token-oracle-2:settle_ts — no settle stamp — card loop may not be ticking
✓ session:token-oracle-3:state — state=idle
✓ session:token-oracle-3:leases — leases parseable (0 entries)
✓ agent-status — dir=/run/user/1000/agent-status provider-files≈3 (informational)
✓ card-loop-bin — curtain-card-session.sh resolves $ROOT/bin/herald
task 10: done — AGENT-STATUS-PROVIDERS.md
task 11: done — full suite green (378 tests)
--- doctor live ---
✗ session:syndcast-3:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-4:state — state=done
✓ session:syndcast-4:leases — leases parseable (0 entries)
✗ session:syndcast-4:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-5:state — state=done
✓ session:syndcast-5:leases — leases parseable (0 entries)
✗ session:syndcast-5:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-6:state — state=done
✓ session:syndcast-6:leases — leases parseable (0 entries)
✗ session:syndcast-6:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-7:state — state=done
✓ session:syndcast-7:leases — leases parseable (0 entries)
✗ session:syndcast-7:settle_ts — no settle stamp — card loop may not be ticking
✓ session:syndcast-8:state — state=done
✓ session:syndcast-8:leases — leases parseable (0 entries)
✗ session:syndcast-8:settle_ts — no settle stamp — card loop may not be ticking
✓ session:token-oracle:state — state=idle
✓ session:token-oracle:leases — leases parseable (0 entries)
✓ session:token-oracle-2:state — state=done
✓ session:token-oracle-2:leases — leases parseable (0 entries)
✗ session:token-oracle-2:settle_ts — no settle stamp — card loop may not be ticking
✓ session:token-oracle-3:state — state=idle
✓ session:token-oracle-3:leases — leases parseable (0 entries)
✓ agent-status — dir=/run/user/1000/agent-status provider-files≈3 (informational)
✓ card-loop-bin — curtain-card-session.sh resolves $ROOT/bin/herald
task 1: done — status-herald docs (README Works well with, CHANGELOG migration, AGENTS providers pointer)
