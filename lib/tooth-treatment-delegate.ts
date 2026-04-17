import { z } from 'zod';

/** Fogszintű kezelés delegálása Feladataim-ba (belső user vagy külső szakember szöveges megjelöléssel). */
export const toothTreatmentDelegateSchema = z
  .object({
    mode: z.enum(['staff', 'external']),
    assigneeUserId: z.string().uuid().optional(),
    /** Külső címzett (nincs rendszerbeli fiókja) — szabad szöveg, pl. név + telefon. */
    externalAssigneeLabel: z.string().trim().min(2).max(500).optional(),
    /**
     * Külső esetén kinél jelenjen meg a nyitott feladat (Feladataim).
     * Hiányzik → a küldő kapja (hogy követhető maradjon a koordináció).
     */
    taskOwnerUserId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
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
    if (data.dueAt) {
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
  });

export type ToothTreatmentDelegateInput = z.infer<typeof toothTreatmentDelegateSchema>;
