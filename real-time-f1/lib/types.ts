export interface Race {
    round: string
    raceName: string
    circuitName: string
    country: string
    date: string
    time: string
    firstPractice: {
        date: string
        time: string
    }
    secondPractice: {
        date: string
        time: string
    }
    thirdPractice?: {
        date: string
        time: string
    }
    qualifying: {
        date: string
        time: string
    }
    sprint?: {
        date: string
        time: string
    }
}