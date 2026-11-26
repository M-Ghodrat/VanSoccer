import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { BookOpen, Plus, Trash2, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { EducationPost, PlayerProfile, SOCCER_POSITIONS } from '../types';

interface EducationViewProps {
  user: User;
  profile: PlayerProfile;
  posts: EducationPost[];
}

const CATEGORIES: EducationPost['category'][] = [
  'Tactics',
  'Positioning',
  'Conditioning',
  'Rules & Fair Play',
];

export const EducationView: React.FC<EducationViewProps> = ({ user, profile, posts }) => {
  const isManagerOrAdmin = profile.role === 'manager' || profile.role === 'admin';
  const [filterCat, setFilterCat] = useState<'All' | EducationPost['category']>('All');
  const [selectedPost, setSelectedPost] = useState<EducationPost | null>(posts[0] || null);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EducationPost['category']>('Tactics');
  const [targetPositions, setTargetPositions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredPosts = posts.filter((p) => filterCat === 'All' || p.category === filterCat);

  const togglePosition = (pos: string) => {
    setTargetPositions((prev) =>
      prev.includes(pos) ? prev.filter((x) => x !== pos) : [...prev, pos].slice(0, 5)
    );
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 3 || summary.trim().length < 5 || content.trim().length < 10) {
      setError('Please enter a valid title, summary, and full guide content.');
      return;
    }

    setBusy(true);
    try {
      const postId = `edu_${Date.now()}`;
      const newPost = {
        id: postId,
        title: title.trim().slice(0, 140),
        category,
        targetPositions,
        summary: summary.trim().slice(0, 400),
        content: content.trim().slice(0, 5000),
        authorId: user.uid,
        authorName: `${profile.firstName} ${profile.lastName}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'education_posts', postId), newPost);
      setTitle('');
      setSummary('');
      setContent('');
      setTargetPositions([]);
      setCreating(false);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, 'education_posts');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to publish post.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (postId: string) => {
    setError(null);
    try {
      await deleteDoc(doc(db, 'education_posts', postId));
      if (selectedPost?.id === postId) setSelectedPost(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `education_posts/${postId}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not delete guide.');
      }
    }
  };

  const activePost =
    selectedPost && posts.find((p) => p.id === selectedPost.id)
      ? posts.find((p) => p.id === selectedPost.id)!
      : filteredPosts[0] || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Education
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
            {(['All', ...CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCat(cat)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  filterCat === cat ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              title={creating ? 'Close editor' : 'New guide'}
              aria-label={creating ? 'Close editor' : 'New guide'}
              className={`p-2 rounded-lg transition-colors shrink-0 ${
                creating
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
              }`}
            >
              {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {creating && isManagerOrAdmin && (
        <form
          onSubmit={handlePublish}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Publish New Educational Material</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Compact Midfield Pressing Triggers in 7v7 & 11v11"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Category *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as EducationPost['category'])}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Relevant Positions (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SOCCER_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => togglePosition(pos)}
                  className={`px-2.5 py-1 rounded text-xs font-mono-tabular font-semibold border transition-colors ${
                    targetPositions.includes(pos)
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Short Summary *</label>
            <input
              type="text"
              required
              maxLength={400}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-sentence takeaway for players before matchday."
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Guide & Drills *</label>
            <textarea
              rows={6}
              required
              maxLength={5000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write tactical notes, positioning cues, warm-up steps, or Vancouver turf etiquette..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-60"
            >
              {busy ? 'Publishing...' : 'Publish Guide'}
            </button>
          </div>
        </form>
      )}

      {filteredPosts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <BookOpen className="w-9 h-9 text-slate-400 mx-auto" />
          <h2 className="font-display text-2xl font-bold text-slate-900">No Educational Guides Yet</h2>
          <p className="text-sm text-slate-500">
            {isManagerOrAdmin
              ? 'Publish your first tactical guide or warm-up protocol using the button above.'
              : 'Club managers will post tactical briefings and conditioning notes here.'}
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden self-start">
            {filteredPosts.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => setSelectedPost(post)}
                className={`w-full text-left p-4 space-y-1 transition-colors ${
                  activePost?.id === post.id ? 'bg-emerald-50/80' : 'hover:bg-slate-50'
                }`}
              >
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span className="font-semibold text-emerald-700">{post.category}</span>
                  {post.targetPositions.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{post.targetPositions.join(', ')}</span>
                    </>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-900">{post.title}</div>
                <p className="text-xs text-slate-600 line-clamp-2">{post.summary}</p>
              </button>
            ))}
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            {activePost && (
              <article className="space-y-4">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="space-y-1.5">
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-emerald-700">{activePost.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>By {activePost.authorName}</span>
                      {activePost.targetPositions.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            Positions: {activePost.targetPositions.join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
                      {activePost.title}
                    </h2>
                  </div>
                  {isManagerOrAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDelete(activePost.id)}
                      className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors shrink-0"
                      title="Delete post"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-700">{activePost.summary}</p>
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap pt-2">
                  {activePost.content}
                </div>
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
