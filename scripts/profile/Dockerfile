# perf for profiling the local atlas server. The host keeps perf_event_paranoid
# restrictive; this container runs with CAP_PERFMON in the host PID namespace instead.
# See docs/local-atlas.md.
FROM rockylinux/rockylinux:10
RUN dnf -y install perf && dnf clean all
