import type { CommentJson } from '../core/comments'
import { MAX_COMMENT_LENGTH } from '../core/comments'
import { tokenize } from '../lib/comment-text'
import { Time } from './layout'

/** 阅读页底部的文末讨论（仅登录用户可见，不进入边缘缓存） */
export function CommentText({ body, names }: { body: string; names: Record<string, string> }) {
  return (
    <>
      {tokenize(body).map((x) =>
        x.t === 'mention' ? (
          <span class="mention">@{names[x.id] ?? '未知用户'}</span>
        ) : x.t === 'link' ? (
          <a href={x.v} target="_blank" rel="noopener nofollow ugc">
            {x.v}
          </a>
        ) : (
          x.v
        ),
      )}
    </>
  )
}

export function Discussion(props: {
  docId: string
  comments: CommentJson[]
  names: Record<string, string>
  userId: string
  canModerate: boolean
}) {
  const roots = props.comments.filter((c) => !c.parentId && !c.anchor)
  const replies = (id: string) => props.comments.filter((c) => c.parentId === id)
  const count = roots.reduce((n, r) => n + 1 + replies(r.id).length, 0)
  const item = (c: CommentJson) => (
    <div class="comment" id={`c-${c.id}`}>
      <div class="comment-head">
        <strong>{c.authorName ?? '已注销用户'}</strong>
        <Time ts={c.createdAt} />
        {(c.authorId === props.userId || props.canModerate) && (
          <button class="link comment-del" data-del={c.id}>
            删除
          </button>
        )}
      </div>
      <div class="comment-body">
        <CommentText body={c.body} names={props.names} />
      </div>
    </div>
  )
  return (
    <section class="discussion" id="discussion" data-doc={props.docId}>
      <h2>
        讨论 {count > 0 && <span class="muted">{count}</span>}
      </h2>
      {roots.map((r) => (
        <div class="thread">
          {item(r)}
          {replies(r.id).map(item)}
          <button class="link small" data-reply={r.id}>
            回复
          </button>
        </div>
      ))}
      <form class="comment-form">
        <textarea class="input" name="body" rows={3} maxlength={MAX_COMMENT_LENGTH} required placeholder="参与讨论…" />
        <div>
          <button class="btn btn-primary btn-sm">发表</button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: DISCUSSION_JS }} />
    </section>
  )
}

const DISCUSSION_JS = `(function(){
var root=document.getElementById('discussion'),doc=root.dataset.doc;
function req(url,opts){return fetch(url,opts).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error||('请求失败（'+r.status+'）'));return d})})}
function done(){location.hash='discussion';location.reload()}
root.addEventListener('submit',function(e){
  var f=e.target;if(!f.classList.contains('comment-form'))return;e.preventDefault();
  var btn=f.querySelector('button');btn.disabled=true;
  req('/api/docs/'+doc+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:f.body.value,parentId:f.dataset.parent||null})})
    .then(done,function(err){btn.disabled=false;alert(err.message)});
});
root.addEventListener('click',function(e){
  var t=e.target;
  if(t.dataset.del){if(!confirm('删除这条评论？'))return;req('/api/comments/'+t.dataset.del,{method:'DELETE'}).then(done,function(err){alert(err.message)})}
  if(t.dataset.reply){
    var next=t.nextElementSibling;if(next&&next.classList.contains('comment-form')){next.remove();return}
    var f=root.querySelector(':scope > form.comment-form').cloneNode(true);f.dataset.parent=t.dataset.reply;
    f.body.value='';f.body.placeholder='回复…';f.body.rows=2;f.querySelector('button').textContent='回复';
    t.after(f);f.body.focus();
  }
});
})()`
