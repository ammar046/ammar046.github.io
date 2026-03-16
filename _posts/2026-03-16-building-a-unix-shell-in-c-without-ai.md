---
title: "Building a Unix Shell in C Without AI — Learning the Hard Way"
date: 2026-03-16 00:00:00 +0000
categories: [systems, c, unix]
---

I wanted to understand how a Unix shell actually works under the hood.

Not from lecture slides. Not from a polished tutorial. And definitely not from auto-generated code.

So I decided to build one from scratch in C. I picked a shell specifically because it sits right at the boundary between user-space and the operating system — every command you type goes through this one small program before the kernel ever sees it. I wanted to know exactly what happens in that gap.

There was one rule for the entire project:

- No AI assistance for writing the code.
- No Copilot. No ChatGPT. No autocomplete writing logic for me.

If something broke, the workflow was simple:

- Read the man page
- Compile again
- Run gdb
- Inspect memory
- Repeat until the program stopped crashing

This post covers Phase 1 — building the basic command loop, implementing a few built-ins, launching programs using the fork–exec model, and surviving the first wave of segmentation faults.

## The Shell Loop

Every shell starts with the same idea:

**read → parse → execute → repeat**

My shell loop reads input, tokenizes it, checks for built-in commands, and otherwise tries to execute a program from `$PATH`.

```c
printf("$ ");
char input[100];

while (fgets(input, sizeof(input), stdin))
{
    input[strcspn(input, "\r\n")] = 0;

    char *cpy = malloc(strlen(input) + 1);
    strcpy(cpy, input);

    char *cmd = strtok(input, " ");
}
```

One subtle but important detail here is the **copy of the input string** — and it only exists because I learned why the hard way.

---

## The `strtok()` Trap

At first I used `strtok()` directly on the input string. That seemed harmless.

Then parts of my parsing logic started behaving strangely in ways I couldn't immediately explain. Commands would parse correctly on their own, then silently break when other functions ran nearby.

The reason is that **`strtok()` modifies the original string** by inserting null terminators in place of delimiters. If the user types:

```
echo hello world
```

After tokenization the memory actually looks like this:

```
echo\0hello\0world
```

The original string is destroyed. Any other part of the shell that still needed the full command string was now reading garbage.

The fix was simple once I understood it: tokenize a copy instead.

```c
char *cpy = malloc(strlen(input) + 1);
strcpy(cpy, input);

char *cmd = strtok(input, " ");
```

There is also a second trap that bit me later: `strtok()` maintains global internal state. If another function calls `strtok()` while the first tokenization is still in progress, the internal pointer resets and the original parse breaks silently. No error. No warning. Just wrong behavior.

This is the kind of thing that does not show up in tutorials. You only notice it when you are deep in low-level code with no safety net.

## Searching for Commands in `$PATH`

If the command is not a shell builtin, the shell needs to locate the executable inside the directories listed in the `PATH` environment variable.

I implemented that using a helper function:

```c
char *find_in_path(char *command)
{
    char *path_env = getenv("PATH");
    if (!path_env)
        return NULL;

    char *path_copy = strdup(path_env);
    char *dir = strtok(path_copy, ":");
    static char result_path[4096];
```

The shell iterates through each directory in `$PATH` and checks if the command exists there:

```c
while (dir != NULL)
{
    snprintf(result_path, sizeof(result_path), "%s/%s", dir, command);

    if (access(result_path, X_OK) == 0)
    {
        found = 1;
        break;
    }

    dir = strtok(NULL, ":");
}
```

Again, notice the copy of `PATH`. Whenever C code starts modifying strings, you quickly learn that ownership of memory matters — and that the standard library will not protect you from yourself.

## The Fork–Exec Model

The most important part of the shell is how it actually runs programs.

A shell does not run programs itself. Instead it:

- forks a child process
- the child executes the requested program
- the parent waits for the child to finish

Here is the core logic:

```c
pid_t pid = fork();

if (pid == 0)
{
    execvp(path_found, args);
    perror("exec failed!\n");
}
else if (pid < 0)
{
    perror("FORK FAILED!\n");
}
else
{
    wait(NULL);
}
```

The first time I ran this, I expected something more complicated. Instead `fork()` just duplicated the process, the child replaced itself with the new program via `execvp()`, and the parent sat in `wait()` until it finished.

What surprised me was how clean the model is. The shell is not "running" commands at all — it is creating processes and handing work off to the operating system. The kernel does the heavy lifting. The shell is just the coordinator.

One thing I learned immediately: if the parent does not call `wait()`, the child becomes a zombie process — it finishes execution but its entry stays in the process table because nothing collected its exit status. Valgrind does not catch this. You have to know to look for it.

## Building the Argument List

Commands also need arguments, so the shell builds an argument array dynamically:

```c
char **args = NULL;

args = realloc(args, (count + 1) * sizeof(char *));
args[count] = malloc(strlen(name) + 1);
strcpy(args[count], name);
count++;
```

Additional arguments are appended the same way:

```c
char *arg = strtok(NULL, " ");

while (arg != NULL)
{
    args = realloc(args, (count + 1) * sizeof(char *));
    args[count] = malloc(strlen(arg) + 1);
    strcpy(args[count], arg);
    count++;

    arg = strtok(NULL, " ");
}
```

Finally the array must be terminated with `NULL` because `execvp()` expects that format:

```c
args = realloc(args, (count + 1) * sizeof(char *));
args[count] = NULL;
```

One missing `NULL` here caused one of the more confusing segfaults I hit in this phase. The program would crash inside `execvp()` with no obvious reason. GDB was the only way out.

---

## Debugging with GDB

Segmentation faults became routine. The first few I tried to solve by staring at the code, which mostly just wasted time.

Eventually I stopped guessing and started using GDB properly.

Compile with debugging symbols:

```bash
gcc shell.c -g
```

Then run:

```bash
gdb ./a.out
```

The workflow that actually helped:

```gdb
break lsh_loop
run
step
print args
```

The most useful moment was stepping through the argument builder and printing `args` at each iteration. I could see exactly where the array was malformed — one slot too short, no null terminator, `execvp()` walking off the end. Two minutes in GDB saved what would have been an hour of guessing.

Once you can watch your own memory in real time, a lot of C's chaos starts to feel manageable.

---

## Finding Memory Leaks with Valgrind

C requires **manual memory management**. Every `malloc` must eventually be paired with a `free`. It is easy to forget this when you are focused on getting something to work.

Once the shell was running, I checked it with Valgrind:

```bash
valgrind --leak-check=full ./shell
```

It immediately flagged leaks in the argument parser. The problem was that I was freeing the args array itself but not the individual strings inside it — each one had been separately allocated with `malloc` and each one needed its own `free`.

```c
for (int i = 0; i < count; i++)
{
    free(args[i]);
}

free(args);
free(name);
```

Valgrind is brutally honest about this. It does not care that the program runs correctly — it will tell you exactly what you forgot to clean up. Running it after every major change became a habit quickly.

## Phase 1 Complete

At this point the shell can:

- run external commands
- support basic built-ins (echo, pwd, type, exit)
- resolve programs using `$PATH`
- execute programs using `fork()` and `execvp()`
- manage memory without leaks

It is still primitive. There is no support yet for pipes, I/O redirection, background jobs, or signal handling. Those come next.

But Phase 1 accomplished what I actually wanted: a real understanding of how a shell talks to the operating system — not a conceptual one, but the kind you only get from watching your own code segfault and figuring out why.

Doing it without AI meant every bug was mine to find. Every fix came from a man page or a GDB session, not a suggestion box. That friction turned out to be the point.

Next: pipelines, redirection, and job control.
