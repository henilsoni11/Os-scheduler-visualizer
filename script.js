// ---------- State ----------
let processes = [];

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

// Merge back-to-back segments of the same process
function mergeSegments(timeline) {
  const merged = [];
  for (const seg of timeline) {
    const last = merged[merged.length - 1];
    if (last && last.pid === seg.pid && last.end === seg.start) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// ---------- Algorithms ----------
// Each returns a timeline: [{ pid, start, end }, ...]

function fcfs(procs) {
  const list = [...procs].sort((a, b) => a.arrival - b.arrival);
  const timeline = [];
  let time = 0;
  for (const p of list) {
    if (time < p.arrival) {
      timeline.push({ pid: "Idle", start: time, end: p.arrival });
      time = p.arrival;
    }
    timeline.push({ pid: p.pid, start: time, end: time + p.burst });
    time += p.burst;
  }
  return mergeSegments(timeline);
}

function priorityScheduling(procs) {
  const remaining = [...procs];
  const timeline = [];
  let time = 0;
  while (remaining.length > 0) {
    const available = remaining.filter((p) => p.arrival <= time);
    if (available.length === 0) {
      const nextArrival = Math.min(...remaining.map((p) => p.arrival));
      timeline.push({ pid: "Idle", start: time, end: nextArrival });
      time = nextArrival;
      continue;
    }
    // lowest number = highest priority; tie -> earlier arrival
    available.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);
    const p = available[0];
    timeline.push({ pid: p.pid, start: time, end: time + p.burst });
    time += p.burst;
    remaining.splice(remaining.indexOf(p), 1);
  }
  return mergeSegments(timeline);
}

function roundRobin(procs, quantum) {
  const list = [...procs].sort((a, b) => a.arrival - b.arrival);
  const remaining = {};
  list.forEach((p) => (remaining[p.pid] = p.burst));

  const timeline = [];
  const queue = [];
  let time = 0;
  let i = 0;
  let done = 0;

  while (done < list.length) {
    while (i < list.length && list[i].arrival <= time) {
      queue.push(list[i]);
      i++;
    }
    if (queue.length === 0) {
      const next = list[i].arrival;
      timeline.push({ pid: "Idle", start: time, end: next });
      time = next;
      continue;
    }
    const p = queue.shift();
    const run = Math.min(quantum, remaining[p.pid]);
    timeline.push({ pid: p.pid, start: time, end: time + run });
    time += run;
    remaining[p.pid] -= run;

    // new arrivals during this slice go in BEFORE the preempted process
    while (i < list.length && list[i].arrival <= time) {
      queue.push(list[i]);
      i++;
    }
    if (remaining[p.pid] > 0) queue.push(p);
    else done++;
  }
  return mergeSegments(timeline);
}

// ---------- Metrics ----------
function calculateMetrics(procs, timeline) {
  return procs.map((p) => {
    const completion = Math.max(
      ...timeline.filter((s) => s.pid === p.pid).map((s) => s.end)
    );
    const turnaround = completion - p.arrival;
    const waiting = turnaround - p.burst;
    return { pid: p.pid, completion, turnaround, waiting };
  });
}

// ---------- UI: process table ----------
function renderProcesses() {
  $("processBody").innerHTML = processes
    .map(
      (p, idx) => `
      <tr>
        <td>${p.pid}</td>
        <td>${p.arrival}</td>
        <td>${p.burst}</td>
        <td>${p.priority}</td>
        <td><button class="secondary" onclick="removeProcess(${idx})">✕</button></td>
      </tr>`
    )
    .join("");
}

function removeProcess(idx) {
  processes.splice(idx, 1);
  renderProcesses();
}

$("addBtn").addEventListener("click", () => {
  const pid = $("pid").value.trim();
  const arrival = parseInt($("arrival").value);
  const burst = parseInt($("burst").value);
  const priority = parseInt($("priority").value) || 1;

  if (!pid || isNaN(arrival) || isNaN(burst) || arrival < 0 || burst < 1) {
    alert("Enter a PID, arrival time (>= 0) and burst time (>= 1).");
    return;
  }
  if (processes.some((p) => p.pid === pid)) {
    alert("PID already exists. Use a unique PID.");
    return;
  }
  processes.push({ pid, arrival, burst, priority });
  renderProcesses();
  ["pid", "arrival", "burst", "priority"].forEach((id) => ($(id).value = ""));
});

$("sampleBtn").addEventListener("click", () => {
  processes = [
    { pid: "P1", arrival: 0, burst: 5, priority: 2 },
    { pid: "P2", arrival: 1, burst: 3, priority: 1 },
    { pid: "P3", arrival: 2, burst: 8, priority: 4 },
    { pid: "P4", arrival: 3, burst: 6, priority: 3 },
  ];
  renderProcesses();
});

$("clearBtn").addEventListener("click", () => {
  processes = [];
  renderProcesses();
  $("resultBody").innerHTML = "";
  $("averages").textContent = "";
  $("gantt").innerHTML = "";
  $("timeline").innerHTML = "";
});

// ---------- UI: run simulation ----------
$("runBtn").addEventListener("click", () => {
  if (processes.length === 0) {
    alert("Add at least one process first.");
    return;
  }
  const algo = $("algo").value;
  const quantum = parseInt($("quantum").value) || 2;

  let timeline;
  if (algo === "fcfs") timeline = fcfs(processes);
  else if (algo === "priority") timeline = priorityScheduling(processes);
  else timeline = roundRobin(processes, quantum);

  const metrics = calculateMetrics(processes, timeline);

  // results table
  $("resultBody").innerHTML = metrics
    .map(
      (m) => `<tr><td>${m.pid}</td><td>${m.completion}</td>
              <td>${m.turnaround}</td><td>${m.waiting}</td></tr>`
    )
    .join("");

  const avg = (key) =>
    (metrics.reduce((sum, m) => sum + m[key], 0) / metrics.length).toFixed(2);
  $("averages").textContent =
    `Avg Turnaround: ${avg("turnaround")}  |  Avg Waiting: ${avg("waiting")}`;

  renderGantt(timeline);
});

// ---------- Gantt chart with animation ----------
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
                "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];
let animTimers = [];
let lastTimeline = [];

function colorFor(pid) {
  if (pid === "Idle") return "#475569";
  const idx = processes.findIndex((p) => p.pid === pid);
  return COLORS[idx % COLORS.length];
}

function renderGantt(timeline) {
  lastTimeline = timeline;
  animTimers.forEach(clearTimeout);
  animTimers = [];

  const UNIT = 40; // pixels per time unit
  const gantt = $("gantt");
  const ticks = $("timeline");
  gantt.innerHTML = "";
  ticks.innerHTML = "";

  timeline.forEach((seg, i) => {
    const width = (seg.end - seg.start) * UNIT;

    const block = document.createElement("div");
    block.className = "block" + (seg.pid === "Idle" ? " idle" : "");
    block.style.width = width + "px";
    block.style.backgroundColor = colorFor(seg.pid);
    block.textContent = seg.pid;
    gantt.appendChild(block);

    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.width = width + "px";
    tick.innerHTML =
      `<span>${seg.start}</span>` +
      (i === timeline.length - 1 ? `<span class="end">${seg.end}</span>` : "");
    ticks.appendChild(tick);

    // reveal one block after another
    const t = setTimeout(() => {
      block.classList.add("show");
      tick.classList.add("show");
    }, i * 500);
    animTimers.push(t);
  });
}

$("replayBtn").addEventListener("click", () => {
  if (lastTimeline.length > 0) renderGantt(lastTimeline);
});
