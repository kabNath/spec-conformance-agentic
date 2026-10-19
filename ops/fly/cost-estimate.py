#!/usr/bin/env python3
"""Monthly cost of the Fly.io pilot, with the arithmetic. Prices: docs.fly.io/about/pricing and tigrisdata.com, read 2026-10-19.
Change an assumption below and re-run; nothing here is measured on a bill (the real number comes from the Fly dashboard).
LLM/OpenRouter cost is NOT included."""
MULT = 1.307692308          # Tokyo (nrt) region multiplier, applied to machines. Applied to rootfs and volumes too as a CONSERVATIVE
                            # choice: the page does not say whether the multiplier applies to them.
HOURS = 720                 # a machine's monthly price is the cost of running it 30 days
# iad monthly price of each machine (shared-cpu-1x), by memory
PRICE = {"256mb": 2.19, "512mb": 3.69, "1gb": 6.70}
MACHINES = {            # name: (memory, image GB as reported by `docker images` — upper bound for the billed rootfs)
    "app":     ("512mb", 0.538),
    "sidecar": ("256mb", 0.626),
    "db":      ("256mb", 0.411),
    "qdrant":  ("256mb", 0.281),
    "neo4j":   ("1gb",   0.988),
    "backup":  ("256mb", 0.300),   # estimate: alpine + aws-cli + pg client + age
}
VOLUMES_GB = {"db": 3, "neo4j": 2, "qdrant": 1}
ROOTFS = 0.15       # $/GB-month, stopped machines only
VOLUME = 0.15       # $/GB-month, always
SNAPSHOT_FREE_GB = 10
EGRESS = 0.04       # $/GB (Asia Pacific)
TIGRIS_FREE_GB = 5  # Tigris: 5 GB free, then $0.02/GB-month; 10k class-A and 100k class-B requests free; egress free

def hourly(name): return PRICE[MACHINES[name][0]] * MULT / HOURS

def scenario(title, hours, egress_gb):
    compute = {n: hourly(n) * h for n, h in hours.items()}
    rootfs = sum(g * ROOTFS * MULT * (1 - hours.get(n, 0) / HOURS) for n, (_, g) in MACHINES.items())
    vol = sum(VOLUMES_GB.values()) * VOLUME * MULT
    eg = egress_gb * EGRESS
    total = sum(compute.values()) + rootfs + vol + eg
    print(f"\n{title}")
    for n, c in compute.items(): print(f"  {n:8s} {hours[n]:6.1f} h x ${hourly(n):.5f}/h = ${c:6.3f}")
    print(f"  stopped rootfs  {sum(g for _, g in MACHINES.values()):.2f} GB x ${ROOTFS} x {MULT:.3f} (minus running share) = ${rootfs:.3f}")
    print(f"  volumes         {sum(VOLUMES_GB.values())} GB x ${VOLUME} x {MULT:.3f} = ${vol:.3f}   (snapshots: far below the {SNAPSHOT_FREE_GB} GB free)")
    print(f"  egress          {egress_gb} GB x ${EGRESS} = ${eg:.3f}   (Tigris backups: inside the {TIGRIS_FREE_GB} GB / request free tier = $0)")
    print(f"  TOTAL           ${total:.2f} / month")
    return total

BACKUP_H = 1.0   # backup machine: 2 min/day
DB_BACKUP_H = 4.0  # Postgres woken by the backup: ~8 min/day (dump + the proxy's idle-stop delay of "several minutes")

idle = scenario("A. IDLE: nobody clicks (only the daily backup wakes Postgres)",
    {"app": 0, "sidecar": 0, "db": DB_BACKUP_H, "qdrant": 0, "neo4j": 0, "backup": BACKUP_H}, 0.1)
LINGER = 10 / 60
day = 1 + LINGER                      # one prospect hour + ~10 min until the proxy stops each machine
h = 30 * day
test = scenario("B. A PROSPECT TESTS 1 HOUR/DAY (every machine up ~70 min/day; Postgres also woken for the backup)",
    {"app": h, "sidecar": h, "db": h + DB_BACKUP_H, "qdrant": h, "neo4j": h, "backup": BACKUP_H}, 1.0)
worst = scenario("C. WORST CASE: nothing ever stops (auto-stop defeated)",
    {n: HOURS for n in ["app", "sidecar", "db", "qdrant", "neo4j"]} | {"backup": BACKUP_H}, 5.0)
print(f"\nsummary: idle ${idle:.2f} | 1 h/day ${test:.2f} | never stops ${worst:.2f}")
