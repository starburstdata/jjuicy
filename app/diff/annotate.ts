import type { AnnotationOrigin } from "../messages/AnnotationOrigin";
import type { FileAnnotation } from "../messages/FileAnnotation";
import { Lru } from "./cache";

export interface Blame {
    origin: AnnotationOrigin;
    // only the first line of a run is labelled, like `jj file annotate`
    first: boolean;
}

export type BlameLookup = (line: number | null) => Blame | null;

export const annotationCache = new Lru<string, FileAnnotation>(20);

export function annotationKey(commit: string, path: string): string {
    return `${commit}:${path}`;
}

export function blameLookup(annotation: FileAnnotation | null): BlameLookup | null {
    if (!annotation) return null;
    return (line) => {
        if (line == null || line < 1 || line > annotation.lines.length) return null;
        let index = annotation.lines[line - 1];
        return {
            origin: annotation.origins[index],
            first: line == 1 || annotation.lines[line - 2] != index,
        };
    };
}
