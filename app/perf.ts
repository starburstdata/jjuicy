// selection→paint timings for the PRD §7 budgets; read them from the devtools performance
// panel or performance.getEntriesByType("measure")

export function beginMeasure(name: string) {
    performance.mark(`${name}:start`);
}

export function endMeasure(name: string) {
    // rAF runs before the frame is painted, so defer once more to land after it
    requestAnimationFrame(() =>
        setTimeout(() => {
            if (performance.getEntriesByName(`${name}:start`, "mark").length == 0) return;
            performance.measure(name, `${name}:start`);
            performance.clearMarks(`${name}:start`);
        }),
    );
}
