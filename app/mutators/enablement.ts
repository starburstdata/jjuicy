import type { RevHeader } from "../messages/RevHeader";

// must stay in sync with compute_revision_enablement in src/gui/menu.rs
export function revisionEnablement(headers: RevHeader[], ignoreImmutable: boolean = false) {
    let isSingleton = headers.length == 1;
    let anyImmutable = !ignoreImmutable && headers.some((h) => h.is_immutable);
    let hasSingleParent = headers[headers.length - 1]?.parent_ids.length == 1;

    return {
        new_child: true,
        new_parent: !anyImmutable && hasSingleParent,
        edit: isSingleton && !anyImmutable && !headers[0]?.is_working_copy,
        revert: true,
        duplicate: true,
        abandon: !anyImmutable,
        squash: !anyImmutable && hasSingleParent,
        restore: isSingleton && !anyImmutable && hasSingleParent,
        bookmark: isSingleton,
    };
}

export type RevisionAction = keyof ReturnType<typeof revisionEnablement>;
