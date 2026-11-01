import { ref, computed, watch } from 'vue'

const EVENTS_STORAGE_KEY = 'gatherly_events'
const REGISTRATIONS_STORAGE_KEY = 'gatherly_user_registrations'

const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL
  return envUrl ? envUrl.trim().replace(/\/+$/, '') : ''
}
const isApiConfigured = (baseUrl) => baseUrl && !baseUrl.includes('67xxxxxx')

const savedData = localStorage.getItem(EVENTS_STORAGE_KEY)
const events = ref(savedData ? JSON.parse(savedData) : [])

const savedRegs = localStorage.getItem(REGISTRATIONS_STORAGE_KEY)
const userRegistrations = ref(savedRegs ? JSON.parse(savedRegs) : [])

const loading = ref(false)
const error = ref(null)

watch(events, (v) => localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(v)), { deep: true })
watch(
  userRegistrations,
  (v) => localStorage.setItem(REGISTRATIONS_STORAGE_KEY, JSON.stringify(v)),
  { deep: true },
)

export function useEvents() {
  const totalEvents = computed(() => events.value.length)
  const activeEvents = computed(() => events.value.filter((e) => !e.done))
  const completedEvents = computed(() => events.value.filter((e) => e.done))
  const totalRegistrations = computed(() => userRegistrations.value.length)

  // 1. GET semua event
  const fetchEvents = async () => {
    loading.value = true
    error.value = null
    const baseUrl = getApiBaseUrl()
    if (!isApiConfigured(baseUrl)) {
      loading.value = false
      error.value =
        'Alamat REST API belum dikonfigurasi. Silakan masukkan URL MockAPI Anda pada berkas .env (contoh: https://67xxxx.mockapi.io/api/v1).'
      return
    }
    try {
      const response = await fetch(`${baseUrl}/events`)
      if (!response.ok) {
        throw new Error(
          `Gagal memuat data dari server (Status HTTP: ${response.status} ${response.statusText || ''})`,
        )
      }
      const data = await response.json()
      events.value = Array.isArray(data) ? data : []
    } catch (err) {
      error.value = err.message || 'Terjadi kegagalan jaringan saat menghubungi server API.'
    } finally {
      loading.value = false
    }
  }

  // 2. GET satu event berdasarkan id
  const fetchEventById = async (id) => {
    if (!id) return null
    const strId = String(id)
    const existing = events.value.find((e) => String(e.id) === strId)
    if (existing) return existing

    const baseUrl = getApiBaseUrl()
    if (!isApiConfigured(baseUrl)) return null

    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${baseUrl}/events/${strId}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Acara tidak ditemukan pada sistem server.')
        throw new Error(`Gagal mengambil detail acara (Status HTTP: ${response.status})`)
      }
      const eventData = await response.json()
      if (!events.value.some((e) => String(e.id) === strId)) events.value.push(eventData)
      return eventData
    } catch (err) {
      error.value = err.message
      return null
    } finally {
      loading.value = false
    }
  }

  // 3. POST event baru
  const createEvent = async (eventData) => {
    loading.value = true
    error.value = null
    const cleanLoc = (eventData.loc || '').replace(/^[📍\s]+/, '').trim()
    const payload = {
      title: eventData.title.trim(),
      date: eventData.date,
      loc: cleanLoc,
      cat: eventData.cat,
      quota: Number(eventData.quota) || 100,
      price: eventData.price || 'Free',
      desc: eventData.desc.trim(),
      done: false,
    }
    try {
      const baseUrl = getApiBaseUrl()
      if (isApiConfigured(baseUrl)) {
        const response = await fetch(`${baseUrl}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          throw new Error(`Gagal menyimpan acara ke server (Status HTTP: ${response.status})`)
        }
        const createdEvent = await response.json()
        events.value.unshift(createdEvent)
        return createdEvent
      }
      const localEvent = { ...payload, id: String(Date.now()) }
      events.value.unshift(localEvent)
      return localEvent
    } catch (err) {
      error.value = err.message || 'Gagal menyimpan data ke server API'
      throw err
    } finally {
      loading.value = false
    }
  }

  // 4. DELETE event
  const deleteEvent = async (id) => {
    const strId = String(id)
    loading.value = true
    error.value = null
    try {
      const baseUrl = getApiBaseUrl()
      if (isApiConfigured(baseUrl)) {
        const response = await fetch(`${baseUrl}/events/${strId}`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) {
          throw new Error(`Gagal menghapus acara dari server (Status HTTP: ${response.status})`)
        }
      }
      events.value = events.value.filter((e) => String(e.id) !== strId)
      userRegistrations.value = userRegistrations.value.filter((r) => String(r.eventId) !== strId)
    } catch (err) {
      error.value = err.message || 'Gagal menghapus acara dari server'
      throw err
    } finally {
      loading.value = false
    }
  }

  // 5. PUT: tandai selesai
  const completeEvent = async (id) => {
    const strId = String(id)
    const target = events.value.find((e) => String(e.id) === strId)
    if (target) {
      target.done = true
      const baseUrl = getApiBaseUrl()
      if (isApiConfigured(baseUrl)) {
        try {
          await fetch(`${baseUrl}/events/${strId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ done: true }),
          })
        } catch (err) {
          console.warn('Gagal memperbarui status selesai di server:', err)
        }
      }
    }
  }

  const getEventById = (id) => events.value.find((e) => String(e.id) === String(id))

  const registerAttendee = (eventId, participantData) => {
    const strId = String(eventId)
    const event = events.value.find((e) => String(e.id) === strId)
    if (!event || event.quota <= 0) return null

    const regRecord = {
      id: Date.now(),
      eventId: strId,
      eventTitle: event.title,
      eventCat: event.cat,
      eventDate: event.date,
      eventLoc: event.loc,
      bookingCode: 'GTH-' + Date.now().toString().slice(-4),
      registeredAt: new Date().toISOString(),
      fullName: participantData.fullName.trim(),
      email: participantData.email.trim(),
      phone: participantData.phone.trim(),
      dob: participantData.dob,
      reason: participantData.reason.trim(),
    }
    event.quota = Math.max(0, event.quota - 1)
    userRegistrations.value.unshift(regRecord)
    return regRecord
  }

  const isUserRegistered = (eventId) => {
    const strId = String(eventId)
    if (!events.value.some((e) => String(e.id) === strId)) return false
    return userRegistrations.value.some((r) => String(r.eventId) === strId)
  }

  const getRegistrationByEventId = (eventId) =>
    userRegistrations.value.find((r) => String(r.eventId) === String(eventId))

  const cancelRegistration = (eventId) => {
    const strId = String(eventId)
    const idx = userRegistrations.value.findIndex((r) => String(r.eventId) === strId)
    if (idx !== -1) {
      userRegistrations.value.splice(idx, 1)
      const event = events.value.find((e) => String(e.id) === strId)
      if (event) event.quota += 1
      return true
    }
    return false
  }

  const clearAllEvents = () => {
    events.value = []
    localStorage.removeItem(EVENTS_STORAGE_KEY)
  }
  const clearAllRegistrations = () => {
    userRegistrations.value = []
    localStorage.removeItem(REGISTRATIONS_STORAGE_KEY)
  }

  return {
    events,
    loading,
    error,
    totalEvents,
    activeEvents,
    completedEvents,
    userRegistrations,
    totalRegistrations,
    fetchEvents,
    fetchEventById,
    createEvent,
    deleteEvent,
    completeEvent,
    getEventById,
    registerAttendee,
    isUserRegistered,
    getRegistrationByEventId,
    cancelRegistration,
    clearAllEvents,
    clearAllRegistrations,
  }
}