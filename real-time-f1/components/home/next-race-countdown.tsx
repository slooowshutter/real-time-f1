'use client'

import { useEffect, useState } from "react"

interface NextRaceCountdownProps {
    raceDate: string
    raceTime: string
    className?: string
}

export function NextRaceCountdown({ raceDate, raceTime, className }: NextRaceCountdownProps) {
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    })
    const [timeLoaded, setTimeLoaded] = useState(false)

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date().getTime()
            const raceDateTime = new Date(`${raceDate}T${raceTime}`).getTime()
            const distance = raceDateTime - now

            setTimeLeft({
                days: Math.floor(distance / (1000 * 60 * 60 * 24)),
                hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
                seconds: Math.floor((distance % (1000 * 60)) / 1000)
            })
            setTimeLoaded(true)
        }, 1000)

        return () => clearInterval(timer)
    }, [raceDate, raceTime])

    return (
        <div className={`h-full flex flex-col ${className}`}>
            {/* <div>
                Local time: {new Date(`${raceDate}T${raceTime}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
            </div> */}
            <div>
                To go&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {timeLoaded ? `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s` : 'Loading...'}
            </div>
        </div>
    )
}
