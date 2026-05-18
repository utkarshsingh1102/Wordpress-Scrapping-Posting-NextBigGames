import { useEffect, useState } from 'react';
import { api, type Job } from '../lib/api';
import { StatusPill } from '../components/StatusPill';

export default function Logs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    api
      .listJobs()
      .then(({ jobs }) => setJobs(jobs))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <section>
      <h2 className="text-2xl font-semibold mb-4">Logs</h2>
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="rounded border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Found</th>
              <th className="px-3 py-2 text-right">Scraped</th>
              <th className="px-3 py-2 text-right">Published</th>
              <th className="px-3 py-2 text-right">Skipped</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-slate-500">
                  No jobs yet.
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                expanded={expanded === j.id}
                onToggle={() => setExpanded(expanded === j.id ? null : j.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobRow({
  job,
  expanded,
  onToggle,
}: {
  job: Job;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t">
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
          {new Date(job.startedAt).toLocaleString()}
        </td>
        <td className="px-3 py-2">{job.type}</td>
        <td className="px-3 py-2">
          <StatusPill status={job.status} />
        </td>
        <td className="px-3 py-2 text-right">{job.postsFound}</td>
        <td className="px-3 py-2 text-right">{job.postsScraped}</td>
        <td className="px-3 py-2 text-right">{job.postsPublished}</td>
        <td className="px-3 py-2 text-right">{job.postsSkipped}</td>
        <td className="px-3 py-2 text-right">
          {job.errorLog && (
            <button onClick={onToggle} className="text-xs text-blue-600 hover:underline">
              {expanded ? 'hide' : 'errors'}
            </button>
          )}
        </td>
      </tr>
      {expanded && job.errorLog && (
        <tr className="bg-slate-50 border-t">
          <td colSpan={8} className="px-3 py-2">
            <pre className="text-xs whitespace-pre-wrap text-red-700">{job.errorLog}</pre>
          </td>
        </tr>
      )}
    </>
  );
}
