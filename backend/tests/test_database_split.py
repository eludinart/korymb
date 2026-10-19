"""Découpe database_jobs / database_memory — imports stables."""


def test_database_jobs_reexported():
    import database
    import database_jobs

    assert database.job_set_awaiting_hitl is database_jobs.job_set_awaiting_hitl
    assert database.job_resume_after_hitl is database_jobs.job_resume_after_hitl
    assert database.get_hitl_gate is database_jobs.get_hitl_gate


def test_database_memory_reexported():
    import database
    import database_memory

    assert database.get_enterprise_memory is database_memory.get_enterprise_memory
    assert database.merge_enterprise_contexts is database_memory.merge_enterprise_contexts
    assert database.invalidate_enterprise_memory_cache is database_memory.invalidate_enterprise_memory_cache
