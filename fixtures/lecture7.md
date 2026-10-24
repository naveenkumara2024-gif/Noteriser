# Lecture 7: CPU Scheduling Basics

## 1. What is CPU scheduling?

CPU scheduling is the method an operating system uses to decide which process in the ready queue gets the CPU next. Its goal is to keep the CPU busy and to give users acceptable response times. The component that hands the CPU to the chosen process is called the dispatcher. The time the dispatcher takes to stop one process and start another is called dispatch latency.

## 2. Scheduling criteria

- CPU utilization is the percentage of time the CPU is busy.
- Throughput is the number of processes completed per unit time.
- Turnaround time is the total time from submission of a process to its completion.
- Waiting time is the total time a process spends in the ready queue.
- Response time is the time from submission of a request until the first response is produced.

## 3. Scheduling algorithms

First-Come, First-Served (FCFS) schedules processes in the order they arrive. FCFS is non-preemptive and can cause the convoy effect, where short processes wait behind one long process.

Shortest Job First (SJF) selects the process with the smallest next CPU burst. SJF gives the minimum average waiting time for a given set of processes, but the length of the next burst must be predicted.

Round Robin (RR) gives each process a fixed time slice called the time quantum, after which the process is preempted and placed at the end of the ready queue. If the time quantum is very large, RR behaves like FCFS; if it is very small, context-switch overhead increases.
