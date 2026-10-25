# Lecture 7: CPU Scheduling Basics

> Generated from instructor-approved notes. Check flagged items against the source.

> ⚠ Plain-language wording: each rewrite was checked against the source like every other item. An item whose rewrite could not be verified keeps its original wording and says so.

_Generated 2026-10-24._

## Summary

1. CPU scheduling decides which process gets the CPU next. It keeps the CPU busy. It gives acceptable response times. [S1.1] [S1.2]

2. The dispatcher gives the CPU to the chosen process. The time it takes to switch is called dispatch latency. [S1.3] [S1.4]

3. CPU utilization, throughput, turnaround time, waiting time and response time are the measures of a scheduler. [S2.1] [S2.2] [S2.3] [S2.4] [S2.5]

4. FCFS runs processes in arrival order and can cause the convoy effect, where short processes wait behind one long process. [S3.1] [S3.2]

   _Kept original wording: the simplified version could not be verified._

5. SJF gives the minimum average waiting time. The next burst length must be predicted. [S3.3] [S3.4]

6. Round Robin gives each process a fixed time quantum. A very small quantum increases context-switch overhead. [S3.5] [S3.6]

## Glossary

- **Dispatcher**: The part that gives the CPU to the chosen process. [S1.3]

- **Dispatch latency**: The time the dispatcher takes to stop one process and start another. [S1.4]

- **Turnaround time**: The total time from submission of a process until it is complete. [S2.3]

- **Waiting time**: The total time a process waits in the ready queue. [S2.4]

- **Response time**: The time from submission of a request until the first response. [S2.5]

- **Convoy effect**: Short processes that wait behind one long process. [S3.2]

- **Time quantum**: The fixed time slice each process gets in Round Robin. [S3.5]

   _Kept original wording: the simplified version was not easier to read._

- **Preemption**: A process being stopped after its time slice and placed at the end of the ready queue. [S3.5]

   ⚠ Check against source — Only partly supported by the cited text (entailment 0.70).

   _Kept original wording: the simplified version could not be written._

## Practice questions

1. _Short answer_ — What is the role of the dispatcher? [S1.3]

2. _Short answer_ — How is waiting time different from turnaround time? [S2.3] [S2.4]

3. _True or false_ — SJF gives the minimum average waiting time for a given set of processes. [S3.4]

   _Kept original wording: the simplified version was not easier to read._

4. _Multiple choice_ — In Round Robin, what happens if the time quantum is made very small? [S3.6]

   _Kept original wording: the simplified version was not easier to read._
   - A. RR behaves like FCFS
   - B. Context-switch overhead increases
   - C. Throughput becomes zero
   - D. Processes are never preempted

5. _True or false_ — FCFS schedules processes in the order they arrive. [S3.1]

## Answer key

1. It gives the CPU to the chosen process. [S1.3]
2. Waiting time is the time in the ready queue. Turnaround time is the total time from submission to completion. [S2.3] [S2.4]
3. True [S3.4]
4. Context-switch overhead increases [S3.6]
5. True [S3.1]

## Run report

```text
Source sentences: 15   Sections: 3
Items generated: 24 (8 summary, 8 glossary, 8 questions)
Accepted (SUPPORTED): 18   Partial (flagged): 1   Removed: 5
Shown items: 19, each with a quote checked against its cited sentences
Summary coverage: 100% of sections   Repairs: 0/3 improved an item
Tokens: in=6700 out=3350   Cost: $0.0670
Counts reconcile: every generated item is shown or listed as removed
```

## Appendix A: Removed items

Drafts that did not pass the checks, or were not needed. They are listed here so nothing disappears silently, and they are not part of the study aids above.

- **sum-7** (Not supported): Round Robin is the most widely used scheduler in modern operating systems.
  - Why: The cited text does not support this (entailment 0.05).
  - Why: Adds wording the cited text does not use: "most", "widely".
  - Entailment check: the notes do not back this up (score 0.05).
  - New-fact check: not in the notes: widely, modern.
  - Wording check: stronger than the notes: most, widely.
  - Second reviewer: did not run.
  - Repair was tried: the model could not write a supported replacement (the notes do not say this)
  - It cited: S3.5
- **sum-8** (Contradicted by the notes): SJF is impossible to implement in practice.
  - Why: The notes say the opposite (contradiction 0.95).
  - Why: The cited text does not support this (entailment 0.01).
  - Why: Uses words the notes never use: "impossible", "implement", "practice".
  - Why: Adds wording the cited text does not use: "impossible", "in practice".
  - Entailment check: the notes do not back this up (score 0.01).
  - New-fact check: not in the notes: impossible, implement, practice.
  - Wording check: stronger than the notes: impossible, in practice.
  - Second reviewer: did not run.
  - It cited: S3.4
- **q-4** (Not needed): Why can FCFS cause the convoy effect?
  - Why: A valid question that was not needed: 5 questions were already chosen.
  - It cited: S3.2
- **q-6** (Not supported): What is a typical time quantum in milliseconds?
  - Why: Mentions "10", "100", which the notes never state.
  - Why: The cited text does not support this (entailment 0.05).
  - Why: The closest sentence in the notes is S2.3, not the cited S3.6.
  - Entailment check: the notes do not back this up (score 0.05).
  - New-fact check: not in the notes: 10, 100, typical, milliseconds.
  - Second reviewer: did not run.
  - Repair was tried: the model could not write a supported replacement (the notes give no such number)
  - It cited: S3.6
- **q-8** (Duplicate): What is the role of the dispatcher?
  - Why: Duplicate of q-1.
  - Kept instead: q-1
  - It cited: S1.3

## Appendix B: Source sentences

Every sentence cited above, once.

### What is CPU scheduling?

- S1.1 — CPU scheduling is the method an operating system uses to decide which process in the ready queue gets the CPU next.
- S1.2 — Its goal is to keep the CPU busy and to give users acceptable response times.
- S1.3 — The component that hands the CPU to the chosen process is called the dispatcher.
- S1.4 — The time the dispatcher takes to stop one process and start another is called dispatch latency.

### Scheduling criteria

- S2.1 — CPU utilization is the percentage of time the CPU is busy.
- S2.2 — Throughput is the number of processes completed per unit time.
- S2.3 — Turnaround time is the total time from submission of a process to its completion.
- S2.4 — Waiting time is the total time a process spends in the ready queue.
- S2.5 — Response time is the time from submission of a request until the first response is produced.

### Scheduling algorithms

- S3.1 — First-Come, First-Served (FCFS) schedules processes in the order they arrive.
- S3.2 — FCFS is non-preemptive and can cause the convoy effect, where short processes wait behind one long process.
- S3.3 — Shortest Job First (SJF) selects the process with the smallest next CPU burst.
- S3.4 — SJF gives the minimum average waiting time for a given set of processes, but the length of the next burst must be predicted.
- S3.5 — Round Robin (RR) gives each process a fixed time slice called the time quantum, after which the process is preempted and placed at the end of the ready queue.
- S3.6 — If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.
