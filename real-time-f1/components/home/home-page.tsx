import { races } from "@/lib/const"
import { NextRaceCountdown } from "@/components/home/next-race-countdown"
import { driverStandings } from "@/lib/const"

export default async function HomePage() {
    // Find next race
    const now = new Date()
    const nextRace = races.find(race => {
        const raceDate = new Date(`${race.date}T${race.time}`)
        return raceDate > now
    })

    // Find last completed race
    const lastRace = races.findLast(race => {
        const raceDate = new Date(`${race.date}T${race.time}`)
        return raceDate < now
    })

    return (
        <div className="p-4">
            {/* Next Race Countdown */}
            {nextRace && (
                <div className="mb-12">
                    <h2 className="text-lg font-bold text-muted-foreground mb-4">Next Race</h2>
                    <div className="flex flex-row items-end gap-2 text-foreground text-3xl font-medium mb-2">
                        {nextRace.raceName} -  {nextRace.country}
                        <div className="flex flex-col text-muted-foreground text-sm ">
                            <div>
                                Local time: {new Date(`${nextRace.date}T${nextRace.time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
                            </div>
                            <NextRaceCountdown
                                raceDate={nextRace.date}
                                raceTime={nextRace.time}
                                className="text-muted-foreground text-sm "
                            />
                            {/* {new Date(`${nextRace.date}T${nextRace.time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} */}
                        </div>
                    </div>
                </div>
            )}

            {/* Championship Standings */}
            <div className="grid grid-cols-2 gap-8 mb-12">
                <div>
                    <h2 className="text-2xl font-bold mb-4">Driver Standings</h2>
                    <div className="space-y-4">
                        {driverStandings.map((driver, index) => (
                            <div key={driver.driver_number} className="flex items-center gap-4 p-4 bg-card rounded-lg">
                                <div className="text-lg font-medium" style={{color: `#${driver.team_colour}`}}>
                                    {index + 1}
                                </div>
                                <img 
                                    src={driver.headshot_url || 'default-avatar.png'} 
                                    alt={driver.full_name}
                                    className="w-12 h-12 rounded-full object-cover"
                                />
                                <div>
                                    <div className="font-medium">{driver.full_name}</div>
                                    <div className="text-sm text-muted-foreground">{driver.team_name}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <h2 className="text-2xl font-bold mb-4">Constructor Standings</h2>
                    <div className="text-muted-foreground">Data coming soon...</div>
                </div>
            </div>

            {/* Latest Results */}
            {lastRace && (
                <div>
                    <h2 className="text-2xl font-bold mb-4">Latest Race Results</h2>
                    <div className="text-xl mb-2">{lastRace.raceName}</div>
                    <div className="text-gray-500">Results coming soon...</div>
                </div>
            )}
        </div>
    )
}

