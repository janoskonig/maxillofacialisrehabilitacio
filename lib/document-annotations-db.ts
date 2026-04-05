/** SQL fragment: display name for annotation.created_by (same idea as patient_documents list). */
export const ANNOTATION_AUTHOR_COALESCE = `COALESCE(
  u.doktor_neve,
  p.nev,
  u_by_id.doktor_neve,
  p_by_id.nev,
  a.created_by
) as "createdByName"`;

export const ANNOTATION_FROM_JOIN = `
FROM patient_document_annotations a
LEFT JOIN users u ON u.email = a.created_by
LEFT JOIN patients p ON p.email = a.created_by
LEFT JOIN users u_by_id ON a.created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND u_by_id.id::text = a.created_by
LEFT JOIN patients p_by_id ON a.created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p_by_id.id::text = a.created_by
`;
