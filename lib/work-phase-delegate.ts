import { z } from 'zod';

const dueAtField = z.string().datetime().optional();

function refineDueAt(data: { dueAt?: string }, ctx: z.RefinementCtx) {
  if (!data.dueAt) return;
  const d = new Date(data.dueAt);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Érvénytelen határidő', path: ['dueAt'] });
    return;
  }
  if (d.getTime() < Date.now() - 60_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A határidő nem lehet a múltban',
      path: ['dueAt'],
    });
  }
}

const splitItemSchema = z.object({
  label: z.string().trim().min(1, 'A tétel szövege kötelező').max(500),
  assigneeUserId: z.string().uuid().optional(),
});

/** Munkafázis / munkalista feladat delegálása Feladataim-ba, opcionális felosztással. */
export const workPhaseDelegateSchema = z
  .object({
    mode: z.enum(['staff', 'external']),
    assigneeUserId: z.string().uuid().optional(),
    externalAssigneeLabel: z.string().trim().min(2).max(500).optional(),
    taskOwnerUserId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).optional(),
    dueAt: dueAtField,
    /** ≥2 tétel → külön feladat mindegyikből (pl. implantációs kütyük listája). */
    splitItems: z.array(splitItemSchema).min(2).max(30).optional(),
  })
  .superRefine((data, ctx) => {
    refineDueAt(data, ctx);

    if (data.splitItems && data.splitItems.length > 0) {
      if (data.mode === 'external') {
        if (!data.externalAssigneeLabel || data.externalAssigneeLabel.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Külső módban add meg a külső címzett megnevezését',
            path: ['externalAssigneeLabel'],
          });
        }
      } else {
        const hasDefaultAssignee = !!data.assigneeUserId;
        const allHaveAssignee = data.splitItems.every((i) => !!i.assigneeUserId);
        if (!hasDefaultAssignee && !allHaveAssignee) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Válassz alapértelmezett címzettet, vagy minden tételhez rendelj felhasználót',
            path: ['assigneeUserId'],
          });
        }
      }
      return;
    }

    if (data.mode === 'staff') {
      if (!data.assigneeUserId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Válassz címzett felhasználót',
          path: ['assigneeUserId'],
        });
      }
    } else if (!data.externalAssigneeLabel || data.externalAssigneeLabel.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add meg a külső címzett megnevezését (pl. név, elérhetőség)',
        path: ['externalAssigneeLabel'],
      });
    }
  });

export type WorkPhaseDelegateInput = z.infer<typeof workPhaseDelegateSchema>;
