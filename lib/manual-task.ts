import { z } from 'zod';

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

/** Kézi ("manual") Feladataim teendő létrehozása — magamnak vagy kollégának delegálva. */
export const manualTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'A teendő szövege kötelező').max(500),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().optional(),
    /** Üres → magamnak. Megadva → delegálás a kollégának. */
    assigneeUserId: z.string().uuid().optional(),
    /** Beteg-kontextus, ha a beteg kartonjáról hozzuk létre. */
    patientId: z.string().uuid().optional(),
    /** Emlékeztető kérése a határidő előtt (push). */
    remind: z.boolean().optional(),
  })
  .superRefine(refineDueAt);

export type ManualTaskInput = z.infer<typeof manualTaskSchema>;
