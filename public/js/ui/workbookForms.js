// 문제집/문제 생성·수정 폼과 "AI 로 문제집 만들기" 다이얼로그.
import { api, streamPost } from '../api.js';
import { openModal, toast, field, input, textarea, formValues } from './modal.js';
import { escapeHtml } from '../markdown.js';
import { state, emit } from '../state.js';

export function workbookForm(existing = null) {
  return new Promise((resolve) => {
    const wb = existing || {};
    openModal({
      title: existing ? '문제집 수정' : '문제집 추가',
      body: `
        ${field('제목 *', input('title', wb.title))}
        ${field('설명', textarea('description', wb.description, 'rows="3"'))}
        <div class="row" style="gap:12px;align-items:flex-start">
          <div style="flex:1">${field('분야', input('category', wb.category, 'placeholder="예: 마케팅, 제조, 인사"'))}</div>
          <div style="flex:1">${field('난이도', `<select name="difficulty">${['', '초급', '중급', '고급'].map((d) => `<option ${wb.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`)}</div>
        </div>`,
      buttons: [
        { label: '취소', onClick: () => resolve(null) },
        {
          label: existing ? '저장' : '만들기',
          primary: true,
          onClick: async (ctx) => {
            const v = formValues(ctx.body);
            if (!v.title.trim()) {
              toast('제목을 입력하세요.', 'error');
              return false;
            }
            const result = existing ? await api.updateWorkbook(existing.id, v) : await api.createWorkbook(v);
            resolve(result);
          },
        },
      ],
      onClose: () => resolve(null),
    });
  });
}

export function problemForm(wbId, existing = null) {
  return new Promise((resolve) => {
    const p = existing || {};
    const sub = p.submission || {};
    const lines = (arr) => (arr || []).map((x) => (typeof x === 'string' ? x : x.criterion || JSON.stringify(x))).join('\n');
    openModal({
      title: existing ? '문제 수정' : '문제 추가',
      wide: true,
      body: `
        ${field('문제 제목 *', input('title', p.title))}
        ${field('문제 지문 (Markdown)', textarea('prompt', p.prompt, 'rows="8" placeholder="상황 설명과 요구사항을 적으세요. 예: 당신은 ○○팀의 주임입니다. … 보고서를 작성하세요."'))}
        <div class="row" style="gap:12px;align-items:flex-start">
          <div style="flex:2">${field('제출 형식', textarea('format', sub.format, 'rows="3" placeholder="예: 의사결정 보고서, 개요-본문-결론 구조, 표 1개 이상"'))}</div>
          <div style="flex:1">${field('글자 수 제한', input('charLimit', sub.charLimit || '', 'type="number" min="0" placeholder="예: 1000"'), '비우면 제한 없음')}</div>
        </div>
        ${field('산출물 (쉼표로 구분)', input('deliverables', (sub.deliverables || []).join(', '), 'placeholder="보고서 본문, 비교표"'))}
        <div class="row" style="gap:12px;align-items:flex-start">
          <div style="flex:1">${field('힌트 (한 줄에 하나)', textarea('hints', lines(p.hints), 'rows="4"'))}</div>
          <div style="flex:1">${field('평가 기준 / 루브릭 (한 줄에 하나)', textarea('rubric', lines(p.rubric), 'rows="4"'), 'AI 피드백 요청 시 기준으로 사용됩니다')}</div>
        </div>
        <div class="row" style="gap:12px;align-items:flex-start">
          <div style="flex:2">${field('태그 (쉼표)', input('tags', (p.tags || []).join(', ')))}</div>
          <div style="flex:1">${field('난이도', `<select name="difficulty">${['', '초급', '중급', '고급'].map((d) => `<option ${p.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`)}</div>
          <div style="flex:1">${field('예상 소요(분)', input('estimatedMinutes', p.estimatedMinutes || '', 'type="number" min="0"'))}</div>
        </div>
        ${existing ? '' : '<div class="callout">참고자료 파일은 문제를 만든 뒤 "참고자료" 탭에서 추가합니다.</div>'}`,
      buttons: [
        { label: '취소', onClick: () => resolve(null) },
        {
          label: existing ? '저장' : '만들기',
          primary: true,
          onClick: async (ctx) => {
            const v = formValues(ctx.body);
            if (!v.title.trim()) {
              toast('제목을 입력하세요.', 'error');
              return false;
            }
            const splitLines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
            const splitComma = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
            const data = {
              title: v.title,
              prompt: v.prompt,
              submission: { format: v.format, charLimit: v.charLimit ? Number(v.charLimit) : null, deliverables: splitComma(v.deliverables) },
              hints: splitLines(v.hints),
              rubric: splitLines(v.rubric),
              tags: splitComma(v.tags),
              difficulty: v.difficulty,
              estimatedMinutes: v.estimatedMinutes ? Number(v.estimatedMinutes) : null,
            };
            resolve(existing ? await api.updateProblem(wbId, existing.id, data) : await api.createProblem(wbId, data));
          },
        },
      ],
      onClose: () => resolve(null),
    });
  });
}

/** AI 로 문제집 만들기. 완료되면 생성된 문제집을 resolve. */
export function aiGenerateDialog({ workbookId = null } = {}) {
  return new Promise((resolve) => {
    let abort = null;
    const ctx = openModal({
      title: workbookId ? 'AI 로 문제 추가' : 'AI 로 문제집 만들기',
      body: `
        <div class="callout">상단바에서 선택한 <b>${escapeHtml(state.provider || '')}</b> / <b>${escapeHtml(state.model || '(모델 미지정)')}</b> 모델이 사용됩니다. 문제·참고자료가 함께 생성되며 1~3분 걸릴 수 있습니다.</div>
        ${field('주제 / 분야 *', input('topic', '', 'placeholder="예: 중소 제조기업 생산관리 보고서 작성, 마케팅 캠페인 예산 의사결정"'))}
        <div class="row" style="gap:12px">
          <div style="flex:1">${field('문제 수', input('count', '3', 'type="number" min="1" max="10"'))}</div>
          <div style="flex:1">${field('난이도', `<select name="difficulty"><option>초급</option><option selected>중급</option><option>고급</option></select>`)}</div>
          <div style="flex:2">${field('대상 학습자', input('audience', '', 'placeholder="예: 입사 1~3년차 사무직"'))}</div>
        </div>
        ${field('추가 요구사항', textarea('extra', '', 'rows="3" placeholder="예: 참고자료에 CSV 매출 데이터를 꼭 포함, 모든 문제에 글자 수 제한 1000자"'))}
        <div data-progress class="small muted"></div>`,
      buttons: [
        { label: '취소', onClick: () => { abort?.(); resolve(null); } },
        {
          label: '✨ 생성 시작',
          primary: true,
          close: false,
          onClick: (c) => {
            const v = formValues(c.body);
            if (!v.topic.trim()) {
              toast('주제를 입력하세요.', 'error');
              return false;
            }
            const prog = c.body.querySelector('[data-progress]');
            const btns = c.foot.querySelectorAll('button');
            btns[1].disabled = true;
            prog.textContent = '요청 중…';
            abort = streamPost(
              '/api/generate/workbook',
              { ...v, count: Number(v.count), provider: state.provider, model: state.model, workbookId },
              {
                meta: (m) => (prog.textContent = `${m.provider}/${m.model} 로 생성 중…`),
                progress: (p) => (prog.textContent = `생성 중… ${p.chars.toLocaleString()}자 수신`),
                done: (d) => {
                  toast(`문제집 생성 완료: ${d.workbook.title}`, 'ok');
                  resolve(d.workbook);
                  c.close();
                },
                error: (e) => {
                  prog.innerHTML = `<span style="color:var(--danger)">실패: ${escapeHtml(e.error)}</span>`;
                  btns[1].disabled = false;
                },
              },
            );
            return false;
          },
        },
      ],
      onClose: () => { abort?.(); resolve(null); },
    });
    void ctx;
  });
}

/** 텍스트 참고자료 직접 작성 */
export function newTextReferenceDialog(wbId, pId) {
  return new Promise((resolve) => {
    openModal({
      title: '텍스트 참고자료 작성',
      wide: true,
      body: `
        <div class="row" style="gap:12px">
          <div style="flex:1">${field('파일 이름 *', input('fileName', '자료.md', 'placeholder="예: 매출현황.csv, 규격정보.md"'))}</div>
          <div style="flex:2">${field('설명', input('description', '', 'placeholder="자료 한 줄 설명"'))}</div>
        </div>
        ${field('내용', textarea('content', '', 'rows="14" style="font-family:var(--mono)"'), '.md 는 Markdown, .csv 는 쉼표 구분(첫 줄 헤더)으로 작성하면 미리보기가 예쁘게 나옵니다.')}`,
      buttons: [
        { label: '취소', onClick: () => resolve(null) },
        {
          label: '추가',
          primary: true,
          onClick: async (ctx) => {
            const v = formValues(ctx.body);
            if (!v.fileName.trim()) {
              toast('파일 이름을 입력하세요.', 'error');
              return false;
            }
            resolve(await api.addReference(wbId, pId, v));
          },
        },
      ],
      onClose: () => resolve(null),
    });
  });
}

export async function refreshWorkbooks() {
  const { workbooks } = await api.workbooks();
  state.workbooks = workbooks;
  emit('workbooks:changed', workbooks);
  return workbooks;
}
