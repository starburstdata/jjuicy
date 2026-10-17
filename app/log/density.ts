export type Density = "comfortable" | "compact";

export interface RowGeometry {
    rowHeight: number;
    // vertical centre of the node circle within a row
    nodeY: number;
}

// heights are fixed per density so virtualisation can index rows arithmetically
export function rowGeometry(density: Density): RowGeometry {
    return density == "compact" ? { rowHeight: 30, nodeY: 15 } : { rowHeight: 62, nodeY: 31 };
}

export function parseDensity(value: string | undefined): Density {
    return value == "compact" ? "compact" : "comfortable";
}
