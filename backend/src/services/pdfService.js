// Generates the approval letter / compensation breakdown PDF with PDFKit.
import PDFDocument from 'pdfkit';

const inr = (n) => 'INR ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

export function buildLetter(c, config, res) {
  const approved = c.status === 'APPROVED';
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(13).text('GOVERNMENT OF GOA', { align: 'center' });
  doc.fontSize(11).text(config.department || 'District Administration', { align: 'center' });
  doc.moveDown(0.3).moveTo(56, doc.y).lineTo(539, doc.y).stroke();
  doc.moveDown();

  doc.font('Helvetica-Bold').fontSize(12).text(approved ? 'APPROVAL OF COMPENSATION' : 'PROVISIONAL COMPENSATION STATEMENT (NOT AN APPROVAL)', { align: 'center' });
  doc.moveDown();

  const row = (k, v) => { doc.font('Helvetica-Bold').fontSize(10).text(k + ':', { continued: true }).font('Helvetica').text('  ' + (v ?? '-')); };
  row('Case number', c.case_number);
  row('Scheme', config.name);
  row('Applicant', c.applicant_name);
  row('Status', c.status.replace(/_/g, ' '));
  if (c.submitted_at) row('Date of submission', fmt(c.submitted_at));
  if (approved && c.decision?.at) row('Date of approval', fmt(c.decision.at));
  for (const f of config.form_fields || []) if (c.form_data?.[f.key] !== undefined && c.form_data[f.key] !== '') row(f.label, c.form_data[f.key]);
  doc.moveDown();

  if (c.eligibility) {
    doc.font('Helvetica-Bold').fontSize(11).text('Eligibility determination');
    doc.font('Helvetica').fontSize(9.5).text(c.eligibility.explanation, { align: 'justify' });
    doc.moveDown();
  }

  if (c.compensation) {
    doc.font('Helvetica-Bold').fontSize(11).text('Compensation breakdown');
    doc.font('Helvetica').fontSize(9).fillColor('#444').text(c.compensation.formula || '').fillColor('black');
    doc.moveDown(0.5);
    for (const i of c.compensation.line_items) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).text(i.label + (i.overridden ? ' (revised by officer)' : ''), 56, y, { width: 300 });
      doc.text(inr(i.amount), 380, y, { width: 159, align: 'right' });
      if (i.basis) doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#555').text(i.basis, 56, doc.y, { width: 300 }).fillColor('black');
      doc.moveDown(0.3);
    }
    doc.moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.3);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(11).text(approved ? 'Total compensation approved' : 'Total compensation (provisional)', 56, y, { width: 300 });
    doc.text(inr(c.compensation.final_total), 380, y, { width: 159, align: 'right' });
    if (c.compensation.override) {
      doc.moveDown().font('Helvetica-Oblique').fontSize(9).text(`Note: amount revised by ${c.compensation.override.by} (original calculated total ${inr(c.compensation.override.original_total)}). Justification on record: ${c.compensation.override.justification}`);
    }
  }

  if (approved && c.decision?.officer_name) {
    doc.moveDown(2).font('Helvetica').fontSize(10).text('Approved by: ' + c.decision.officer_name);
    doc.text('Office of the Collector, North Goa District');
  }
  doc.moveDown(2).font('Helvetica-Oblique').fontSize(8).fillColor('#666')
    .text('Computer-generated statement. Every step in this case is recorded in a tamper-evident audit trail. Rule-set version applied: v' + (c.rule_config_version ?? '-') + '.');
  doc.end();
}
