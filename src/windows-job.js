import koffi from 'koffi'

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100

let windowsApi

/**
 * Put a process into a Windows Job Object whose last-handle close terminates the
 * full descendant tree. The returned handle must stay alive for as long as the
 * supervised process is expected to run.
 *
 * Failure is reported without throwing so the existing graceful shutdown and
 * taskkill-by-PID fallback remain available on restricted systems.
 * @param {number | undefined} pid
 */
export function createWindowsJobGuard(pid) {
  if (process.platform !== 'win32') {
    return createInactiveGuard('Windows Job Objects are unavailable on this platform.')
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return createInactiveGuard('A valid process ID is required for Windows Job Object protection.')
  }

  let jobHandle
  let processHandle
  try {
    const api = loadWindowsApi()
    jobHandle = api.CreateJobObjectW(null, null)
    if (isNullHandle(jobHandle)) throw lastWindowsError(api, 'CreateJobObjectW')

    const information = {
      BasicLimitInformation: {
        PerProcessUserTimeLimit: 0,
        PerJobUserTimeLimit: 0,
        LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        MinimumWorkingSetSize: 0,
        MaximumWorkingSetSize: 0,
        ActiveProcessLimit: 0,
        Affinity: 0,
        PriorityClass: 0,
        SchedulingClass: 0,
      },
      IoInfo: {
        ReadOperationCount: 0,
        WriteOperationCount: 0,
        OtherOperationCount: 0,
        ReadTransferCount: 0,
        WriteTransferCount: 0,
        OtherTransferCount: 0,
      },
      ProcessMemoryLimit: 0,
      JobMemoryLimit: 0,
      PeakProcessMemoryUsed: 0,
      PeakJobMemoryUsed: 0,
    }
    if (!api.SetInformationJobObject(
      jobHandle,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
      information,
      koffi.sizeof(api.JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
    )) {
      throw lastWindowsError(api, 'SetInformationJobObject')
    }

    processHandle = api.OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, false, pid)
    if (isNullHandle(processHandle)) throw lastWindowsError(api, 'OpenProcess')
    if (!api.AssignProcessToJobObject(jobHandle, processHandle)) {
      throw lastWindowsError(api, 'AssignProcessToJobObject')
    }
    api.CloseHandle(processHandle)
    processHandle = undefined

    let closed = false
    return {
      active: true,
      error: undefined,
      close() {
        if (closed) return
        closed = true
        api.CloseHandle(jobHandle)
      },
    }
  } catch (error) {
    const api = windowsApi
    if (!isNullHandle(processHandle)) api?.CloseHandle(processHandle)
    if (!isNullHandle(jobHandle)) api?.CloseHandle(jobHandle)
    return createInactiveGuard(error instanceof Error ? error.message : String(error))
  }
}

function createInactiveGuard(error) {
  return { active: false, error, close() {} }
}

function isNullHandle(handle) {
  return handle === undefined || handle === null || handle === 0n || handle === 0
}

function lastWindowsError(api, operation) {
  return new Error(`${operation} failed with Win32 error ${api.GetLastError()}.`)
}

function loadWindowsApi() {
  if (windowsApi !== undefined) return windowsApi
  const kernel32 = koffi.load('kernel32.dll')
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque())
  const JOBOBJECT_BASIC_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
    PerProcessUserTimeLimit: 'int64_t',
    PerJobUserTimeLimit: 'int64_t',
    LimitFlags: 'uint32_t',
    MinimumWorkingSetSize: 'uintptr_t',
    MaximumWorkingSetSize: 'uintptr_t',
    ActiveProcessLimit: 'uint32_t',
    Affinity: 'uintptr_t',
    PriorityClass: 'uint32_t',
    SchedulingClass: 'uint32_t',
  })
  const IO_COUNTERS = koffi.struct('IO_COUNTERS', {
    ReadOperationCount: 'uint64_t',
    WriteOperationCount: 'uint64_t',
    OtherOperationCount: 'uint64_t',
    ReadTransferCount: 'uint64_t',
    WriteTransferCount: 'uint64_t',
    OtherTransferCount: 'uint64_t',
  })
  const JOBOBJECT_EXTENDED_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
    BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    IoInfo: IO_COUNTERS,
    ProcessMemoryLimit: 'uintptr_t',
    JobMemoryLimit: 'uintptr_t',
    PeakProcessMemoryUsed: 'uintptr_t',
    PeakJobMemoryUsed: 'uintptr_t',
  })

  windowsApi = {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    CreateJobObjectW: kernel32.func('HANDLE __stdcall CreateJobObjectW(void *attributes, const char16_t *name)'),
    SetInformationJobObject: kernel32.func('bool __stdcall SetInformationJobObject(HANDLE job, int infoClass, const JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32_t length)'),
    OpenProcess: kernel32.func('HANDLE __stdcall OpenProcess(uint32_t access, bool inheritHandle, uint32_t processId)'),
    AssignProcessToJobObject: kernel32.func('bool __stdcall AssignProcessToJobObject(HANDLE job, HANDLE process)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(HANDLE handle)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
  }
  return windowsApi
}
