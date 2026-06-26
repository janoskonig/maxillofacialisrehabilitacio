import { redirect } from 'next/navigation';

/**
 * A korábbi önálló „Stádium GANTT" oldal beolvadt az egyesített „Kezelési
 * tervek" idővonalba (stádium-sáv + kezelési lépések egy nézetben, „Stádium"
 * nézetmóddal). A régi útvonal ide irányít át, hogy a meglévő linkek ne
 * törjenek el.
 */
export default function StagesGanttRedirect() {
  redirect('/treatment-plans?tplan_view=stage');
}
